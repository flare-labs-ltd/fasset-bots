import { FilterQuery } from "@mikro-orm/core";
import { EM } from "../config/orm";
import { AgentEntity, Event } from "../entities/agent";
import { IAssetAgentContext } from "../fasset-bots/IAssetBotContext";
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
        const agentEnt = await em.findOneOrFail(AgentEntity, { vaultAddress: this.agentVaultAddress } as FilterQuery<AgentEntity>);
        logger.info(`Agent ${this.agentVaultAddress} started reading native events FROM block ${agentEnt.currentEventBlock}`);
        // get all logs for this agent
        const nci = this.context.nativeChainInfo;
        const lastBlock = Math.min(agentEnt.currentEventBlock + maximumBlocks, await this.lastFinalizedBlock());
        const events: EvmEvent[] = [];
        const encodedVaultAddress = web3.eth.abi.encodeParameter("address", this.agentVaultAddress);
        for (let lastBlockRead = agentEnt.currentEventBlock; lastBlockRead <= lastBlock; lastBlockRead += nci.readLogsChunkSize) {
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

    async troubleshootEvents(rootEm: EM): Promise<void> {
        try {
            const agentEnt = await rootEm.findOneOrFail(AgentEntity, { vaultAddress: this.agentVaultAddress } as FilterQuery<AgentEntity>);
            await agentEnt.events.init();
            for (const event of agentEnt.unhandledEvents().sort(eventOrder)) {
                if (this.bot.stopRequested()) return;
                await rootEm
                    .transactional(async (em) => {
                        const fullEvent = await this.getEventFromEntity(event);
                        if (fullEvent != null) {
                            await this.bot.handleEvent(em, fullEvent);
                        } else {
                            await this.notifier.danger(AgentNotificationKey.UNRESOLVED_EVENT,
                                `Event ${event.id} from block ${event.blockNumber} / index ${event.logIndex} could not be found on chain; ir will be skipped.`);
                        }
                        agentEnt.events.remove(event);
                    })
                    .catch(async (error) => {
                        event.retries += 1;
                        if (event.retries > MAX_EVENT_RETRY) {
                            agentEnt.events.remove(event);
                        }
                        await rootEm.persist(agentEnt).flush();
                        console.error(`Error troubleshooting handling of event with id ${event.id} for agent ${this.agentVaultAddress}: ${error}`);
                        logger.error(`Agent ${this.agentVaultAddress} run into error while handling an event:`, error);
                    });
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
