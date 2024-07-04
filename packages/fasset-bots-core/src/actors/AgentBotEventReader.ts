import { EM } from "../config/orm";
import { Event } from "../entities/agent";
import { IAssetAgentContext } from "../fasset-bots/IAssetBotContext";
import { DAYS, blockTimestamp, latestBlockTimestamp } from "../utils";
import { Web3ContractEventDecoder } from "../utils/events/Web3ContractEventDecoder";
import { EvmEvent, eventOrder } from "../utils/events/common";
import { eventIs } from "../utils/events/truffle";
import { logger } from "../utils/logger";
import { AgentNotificationKey, AgentNotifier } from "../utils/notifier/AgentNotifier";
import { web3 } from "../utils/web3";
import { AgentBot } from "./AgentBot";

const MAX_EVENT_RETRY = 5;

export class AgentBotEventReader {
    static deepCopyWithObjectCreate = true;

    constructor(
        public bot: AgentBot,
        public context: IAssetAgentContext,
        public notifier: AgentNotifier,
        public agentVaultAddress: string,
    ) {}

    eventDecoder = new Web3ContractEventDecoder({ assetManager: this.context.assetManager, priceChangeEmitter: this.context.priceChangeEmitter });


    maxHandleEventBlocks = 1000;

    async lastFinalizedBlock() {
        const blockHeight = await web3.eth.getBlockNumber();
        return blockHeight - this.context.nativeChainInfo.finalizationBlocks;
    }

    /**
     * Checks is there are any new events from assetManager.
     * @param em entity manager
     * @returns list of EvmEvents
     */
    async readNewEvents(em: EM, maximumBlocks: number): Promise<[EvmEvent[], number]> {
        const readAgentEnt = await this.bot.fetchAgentEntity(em);
        logger.info(`Agent ${this.agentVaultAddress} started reading native events FROM block ${readAgentEnt.currentEventBlock}`);
        // get all logs for this agent
        const nci = this.context.nativeChainInfo;
        const lastFinalizedBlock = await this.lastFinalizedBlock();
        await this.reportOutdatedAgent(readAgentEnt.currentEventBlock, lastFinalizedBlock, maximumBlocks);
        const lastBlock = Math.min(readAgentEnt.currentEventBlock + maximumBlocks, lastFinalizedBlock);
        const events: EvmEvent[] = [];
        const encodedVaultAddress = web3.eth.abi.encodeParameter("address", this.agentVaultAddress);
        for (let lastBlockRead = readAgentEnt.currentEventBlock; lastBlockRead <= lastBlock; lastBlockRead += nci.readLogsChunkSize) {
            if (this.bot.stopRequested()) break;
            // asset manager events
            const logsAssetManager = await web3.eth.getPastLogs({
                address: this.context.assetManager.address,
                fromBlock: lastBlockRead,
                toBlock: Math.min(lastBlockRead + nci.readLogsChunkSize - 1, lastBlock),
                topics: [null, encodedVaultAddress],
            });
            events.push(...this.eventDecoder.decodeEvents(logsAssetManager));
        }
        logger.info(`Agent ${this.agentVaultAddress} finished reading native events TO block ${lastBlock}`);
        // sort events first by their block numbers, then internally by their event index
        events.sort(eventOrder);
        return [events, lastBlock];
    }

    async reportOutdatedAgent(startBlock: number, lastFinalizedBlock: number, maximumBlocks: number, reportEvery: number = 50_000) {
        if (lastFinalizedBlock - startBlock > maximumBlocks) {
            if (startBlock - this.bot.transientStorage.lastOutdatedEventReported >= reportEvery) {
                const blkTimestamp = await blockTimestamp(startBlock);
                const timestamp = await latestBlockTimestamp();
                const days = (timestamp - blkTimestamp) / DAYS;
                await this.notifier.sendAgentBehindOnEventHandling(lastFinalizedBlock - startBlock, days);
                this.bot.transientStorage.lastOutdatedEventReported = startBlock;
            }
        } else {
            if (this.bot.transientStorage.lastOutdatedEventReported !== 0) {
                await this.notifier.sendAgentEventHandlingCaughtUp();
                this.bot.transientStorage.lastOutdatedEventReported = 0;
            }
        }
    }

    /**
     * Performs appropriate actions according to received events.
     * @param rootEm entity manager
     */
    async handleNewEvents(rootEm: EM): Promise<void> {
        if (this.bot.stopRequested()) return;
        try {
            const readAgentEnt = await this.bot.fetchAgentEntity(rootEm);
            await readAgentEnt.events.init();
            const lastEventRead = readAgentEnt.lastEventRead();
            // eslint-disable-next-line prefer-const
            let [events, lastBlock] = await this.readNewEvents(rootEm, this.maxHandleEventBlocks);
            if (lastEventRead !== undefined) {
                events = events.filter((event) => eventOrder(event, lastEventRead) > 0);
            }
            for (const event of events) {
                if (this.bot.stopRequested()) return;
                try {
                    await this.bot.handleEvent(rootEm, event);
                    // log event is handled here! Transaction committing should be done at the last possible step!
                    await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
                        agentEnt.addNewEvent(new Event(agentEnt, event, true));
                        agentEnt.currentEventBlock = event.blockNumber;
                    });
                } catch (error) {
                    await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
                        agentEnt.addNewEvent(new Event(agentEnt, event, false));
                    });
                    console.error(`Error handling event ${event.signature} for agent ${this.agentVaultAddress}: ${error}`);
                    logger.error(`Agent ${this.agentVaultAddress} run into error while handling an event:`, error);
                }
            }
            await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
                agentEnt.currentEventBlock = lastBlock + 1;
            });
        } catch (error) {
            console.error(`Error handling events for agent ${this.agentVaultAddress}: ${error}`);
            logger.error(`Agent ${this.agentVaultAddress} run into error while handling events:`, error);
        }
    }

    async troubleshootEvents(rootEm: EM): Promise<void> {
        try {
            const readAgentEnt = await this.bot.fetchAgentEntity(rootEm);
            await readAgentEnt.events.init();
            const unhandledEvents = readAgentEnt.unhandledEvents().sort(eventOrder)
            for (const event of unhandledEvents) {
                if (this.bot.stopRequested()) return;
                try {

                    const fullEvent = await this.getEventFromEntity(event);
                    if (fullEvent != null) {
                        await this.bot.handleEvent(rootEm, fullEvent);
                    } else {
                        await this.notifier.danger(AgentNotificationKey.UNRESOLVED_EVENT,
                            `Event ${event.id} from block ${event.blockNumber} / index ${event.logIndex} could not be found on chain; ir will be skipped.`);
                    }
                    await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
                        agentEnt.events.remove(event);
                    });
                } catch (error) {
                    event.retries += 1;
                    if (event.retries > MAX_EVENT_RETRY) {
                        await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
                            agentEnt.events.remove(event);
                        });
                    }
                    console.error(`Error troubleshooting handling of event with id ${event.id} for agent ${this.agentVaultAddress}: ${error}`);
                    logger.error(`Agent ${this.agentVaultAddress} run into error while handling an event:`, error);
                }
            }
        } catch (error) {
            console.error(`Error troubleshooting events for agent ${this.agentVaultAddress}: ${error}`);
            logger.error(`Agent ${this.agentVaultAddress} run into error while troubleshooting events:`, error);
        }
    }

    async getEventFromEntity(event: Event): Promise<EvmEvent | undefined> {
        const encodedVaultAddress = web3.eth.abi.encodeParameter("address", this.agentVaultAddress);
        const events = [];
        const logsAssetManager = await web3.eth.getPastLogs({
            address: this.context.assetManager.address,
            fromBlock: event.blockNumber,
            toBlock: event.blockNumber,
            topics: [null, encodedVaultAddress],
        });
        events.push(...this.eventDecoder.decodeEvents(logsAssetManager));
        for (const _event of events) {
            if (_event.transactionIndex === event.transactionIndex && _event.logIndex === event.logIndex) {
                return _event;
            }
        }
    }


    /**
     * Check if any new PriceEpochFinalized events happened, which means that it may be necessary to topup collateral.
     */
    async checkForPriceChangeEvents() {
        try {
            let needToCheckPrices: boolean;
            let lastPriceReaderEventBlock = this.bot.transientStorage.lastPriceReaderEventBlock;
            if (lastPriceReaderEventBlock >= 0) {
                [needToCheckPrices, lastPriceReaderEventBlock] = await this.priceChangeEventHappened(lastPriceReaderEventBlock + 1);
            } else {
                needToCheckPrices = true;   // this is first time in this method, so check is necessary
                lastPriceReaderEventBlock = await this.lastFinalizedBlock() + 1;
            }
            this.bot.transientStorage.lastPriceReaderEventBlock = lastPriceReaderEventBlock;
            if (needToCheckPrices) {
                logger.info(`Agent ${this.agentVaultAddress} received event 'PriceEpochFinalized'.`);
                await this.bot.collateralManagement.checkAgentForCollateralRatiosAndTopUp();
            }
        } catch (error) {
            console.error(`Error checking for new price events for agent ${this.agentVaultAddress}: ${error}`);
            logger.error(`Agent ${this.agentVaultAddress} run into error while checking for new price events:`, error);
        }
    }

    // AgentBot doesn't need the log of all price change events, it just has to react when a price change event happened recently.
    async priceChangeEventHappened(fromBlock: number): Promise<[boolean, number]> {
        const nci = this.context.nativeChainInfo;
        const lastBlock = await this.lastFinalizedBlock();
        for (let lastBlockRead = fromBlock; lastBlockRead <= lastBlock; lastBlockRead += nci.readLogsChunkSize) {
            const logsPriceChangeEmitter = await web3.eth.getPastLogs({
                address: this.context.priceChangeEmitter.address,
                fromBlock: lastBlockRead,
                toBlock: Math.min(lastBlockRead + nci.readLogsChunkSize - 1, lastBlock),
                topics: [null],
            });
            for (const event of this.eventDecoder.decodeEvents(logsPriceChangeEmitter)) {
                if (eventIs(event, this.context.priceChangeEmitter, "PriceEpochFinalized")) {
                    return [true, lastBlock];
                }
            }
        }
        return [false, lastBlock];
    }
}
