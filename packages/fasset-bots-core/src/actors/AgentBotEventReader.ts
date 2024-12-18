import { EM } from "../config/orm";
import { Event } from "../entities/agent";
import { IAssetAgentContext } from "../fasset-bots/IAssetBotContext";
import { DAYS, assertNotNull, blockTimestamp, isCollateralRatiosChangedEvent, isContractChangedEvent, isPriceChangeEvent, latestBlockTimestamp } from "../utils";
import { Web3ContractEventDecoder } from "../utils/events/Web3ContractEventDecoder";
import { EvmEvent, eventOrder } from "../utils/events/common";
import { logger } from "../utils/logger";
import { AgentNotificationKey, AgentNotifier } from "../utils/notifier/AgentNotifier";
import { web3 } from "../utils/web3";
import { AgentBot } from "./AgentBot";

const MAX_EVENT_RETRY = 5;

export class AgentBotEventReader {
    static deepCopyWithObjectCreate = true;
    private needsToCheckPrices = false;
    private needsToRestartDueToContractChanges = false;

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
        const encodedRedemptionRequestRejectedEvent = web3.eth.abi.encodeEventSignature("RedemptionRequestRejected(address,address,uint64,string,uint256)");
        const encodedRedemptionRequestTakenOverEvent = web3.eth.abi.encodeEventSignature("RedemptionRequestTakenOver(address,address,uint64,uint256,address,uint64)");

        for (let lastBlockRead = readAgentEnt.currentEventBlock; lastBlockRead <= lastBlock; lastBlockRead += nci.readLogsChunkSize) {
            if (this.bot.stopRequested()) break;

            // redemption request rejected events
            const logsRejection = await web3.eth.getPastLogs({
                address: this.context.assetManager.address,
                fromBlock: lastBlockRead,
                toBlock: Math.min(lastBlockRead + nci.readLogsChunkSize - 1, lastBlock),
                topics: [encodedRedemptionRequestRejectedEvent],
            });
            events.push(...this.eventDecoder.decodeEvents(logsRejection));

            // redemption request taken over events
            const logsTakeOver = await web3.eth.getPastLogs({
                address: this.context.assetManager.address,
                fromBlock: lastBlockRead,
                toBlock: Math.min(lastBlockRead + nci.readLogsChunkSize - 1, lastBlock),
                topics: [encodedRedemptionRequestTakenOverEvent],
            });
            events.push(...this.eventDecoder.decodeEvents(logsTakeOver));

            // agent vault asset manager events - remove rejected and taken over events
            const logsAssetManager = (await web3.eth.getPastLogs({
                address: this.context.assetManager.address,
                fromBlock: lastBlockRead,
                toBlock: Math.min(lastBlockRead + nci.readLogsChunkSize - 1, lastBlock),
                topics: [null, encodedVaultAddress],
            })).filter((log) => log.topics[0] !== encodedRedemptionRequestRejectedEvent && log.topics[0] !== encodedRedemptionRequestTakenOverEvent);
            events.push(...this.eventDecoder.decodeEvents(logsAssetManager));

            if (!this.needsToCheckPrices) { // check if CollateralRatiosChanged happened
                for (const event of events) {
                    if (isCollateralRatiosChangedEvent(this.context, event)) {
                        this.needsToCheckPrices = true;
                        break;
                    }
                }
            }
            if (!this.needsToRestartDueToContractChanges) { // check if ContractChanged happened
                for (const event of events) {
                    if (isContractChangedEvent(this.context, event)) {
                        this.needsToRestartDueToContractChanges = true;
                        break;
                    }
                }
            }
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
        /* istanbul ignore next */
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
                /* istanbul ignore next */
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
            await this.oneTimeEventHandler();// handle "one time" events
        } catch (error) {
            console.error(`Error handling events for agent ${this.agentVaultAddress}: ${error}`);
            logger.error(`Agent ${this.agentVaultAddress} run into error while handling events:`, error);
        }
    }
    /* istanbul ignore next */
    async troubleshootEvents(rootEm: EM): Promise<void> {
        try {
            const readAgentEnt = await this.bot.fetchAgentEntity(rootEm);
            await readAgentEnt.events.init();
            const unhandledEvents = readAgentEnt.unhandledEvents().sort(eventOrder)
            for (const event of unhandledEvents) {
                /* istanbul ignore next */
                if (this.bot.stopRequested()) return;
                try {
                    const fullEvent = await this.getEventFromEntity(event);
                    if (fullEvent != null) {
                        await this.bot.handleEvent(rootEm, fullEvent);
                    } else {
                        await this.notifier.danger(AgentNotificationKey.UNRESOLVED_EVENT,
                            `Event ${event.id} from block ${event.blockNumber} / index ${event.logIndex} could not be found on chain; it will be skipped.`);
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
    /* istanbul ignore next */
    async getEventFromEntity(event: Event): Promise<EvmEvent | undefined> {
        const events = [];
        const logsAssetManager = await web3.eth.getPastLogs({
            address: this.context.assetManager.address,
            fromBlock: event.blockNumber,
            toBlock: event.blockNumber,
        });
        events.push(...this.eventDecoder.decodeEvents(logsAssetManager));
        for (const _event of events) {
            if (_event.transactionIndex === event.transactionIndex && _event.logIndex === event.logIndex) {
                return _event;
            }
        }
    }

    /**
     * Handles certain "one time" events, ensuring it only reacts once even if multiple events are received within a certain block range
     */
    async oneTimeEventHandler() {
        if (this.bot.transientStorage.lastOutdatedEventReported === 0) { // only react when all events are up to date
            try {
                if (this.needsToCheckPrices) {
                    this.needsToCheckPrices = false;
                    logger.info(`Agent ${this.agentVaultAddress} received event 'CollateralRatiosChanged'.`);
                    await this.bot.collateralManagement.checkAgentForCollateralRatiosAndTopUp();
                }
            } catch (error) {
                this.needsToCheckPrices = false;
                console.error(`Error handling event 'CollateralRatiosChanged' for agent ${this.agentVaultAddress}: ${error}`);
                logger.error(`Agent ${this.agentVaultAddress} run into error while handling an event 'CollateralRatiosChanged':`, error);
            }
            try {
                if (this.needsToRestartDueToContractChanges) {
                    this.needsToRestartDueToContractChanges = false;
                    logger.info(`Agent ${this.agentVaultAddress} received event 'ContractChanged'.`);
                    console.log(`Agent ${this.agentVaultAddress} received event 'ContractChanged'.`);
                    assertNotNull(this.bot.runner, "Cannot restart - runner not set.");
                    this.bot.runner.restartRequested = true;
                }
            } catch (error) {
                console.error(`Error handling event 'ContractChanged' for agent ${this.agentVaultAddress}: ${error}`);
                logger.error(`Agent ${this.agentVaultAddress} run into error while handling an event 'ContractChanged':`, error);
            }
        }
    }

    /**
     * Check if any new price change events happened, which means that it may be necessary to topup collateral.
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
                logger.info(`Agent ${this.agentVaultAddress} received price change event.`);
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
                if (isPriceChangeEvent(this.context, event)) {
                    return [true, lastBlock];
                }
            }
        }
        return [false, lastBlock];
    }
}
