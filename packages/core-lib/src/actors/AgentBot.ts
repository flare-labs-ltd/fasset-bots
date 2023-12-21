import { FilterQuery, RequiredEntityData } from "@mikro-orm/core";
import { ConfirmedBlockHeightExists } from "@flarenetwork/state-connector-protocol";
import { CollateralReserved, RedemptionRequested } from "../../typechain-truffle/AssetManager";
import { EM } from "../config/orm";
import { AgentEntity, AgentMinting, AgentMintingState, AgentRedemption, AgentRedemptionState, DailyProofState, Event } from "../entities/agent";
import { AgentBotDefaultSettings, IAssetAgentBotContext } from "../fasset-bots/IAssetBotContext";
import { Agent } from "../fasset/Agent";
import { AgentInfo, AgentSettings, CollateralClass } from "../fasset/AssetManagerTypes";
import { PaymentReference } from "../fasset/PaymentReference";
import { CollateralPrice } from "../state/CollateralPrice";
import { SourceId } from "../underlying-chain/SourceId";
import { IBlock, TX_SUCCESS } from "../underlying-chain/interfaces/IBlockChain";
import { Notifier } from "../utils/Notifier";
import { Web3ContractEventDecoder } from "../utils/events/Web3ContractEventDecoder";
import { EventArgs, EvmEvent, eventOrder } from "../utils/events/common";
import { eventIs } from "../utils/events/truffle";
import { attestationWindowSeconds, latestUnderlyingBlock } from "../utils/fasset-helpers";
import { formatArgs } from "../utils/formatting";
import {
    BN_ZERO,
    CCB_LIQUIDATION_PREVENTION_FACTOR,
    DAYS,
    MAX_BIPS,
    NATIVE_LOW_BALANCE,
    NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR,
    STABLE_COIN_LOW_BALANCE,
    XRP_ACTIVATE_BALANCE,
    findOneSubstring,
    toBN,
    toBNExp,
} from "../utils/helpers";
import { requireSecret } from "../config/secrets";
import { logger } from "../utils/logger";
import { artifacts, web3 } from "../utils/web3";
import { latestBlockTimestampBN } from "../utils/web3helpers";
import { web3DeepNormalize } from "../utils/web3normalize";
import { AttestationNotProved } from "../underlying-chain/interfaces/IStateConnectorClient";
import { attestationProved } from "../underlying-chain/AttestationHelper";
import BN from "bn.js";

const AgentVault = artifacts.require("AgentVault");
const CollateralPool = artifacts.require("CollateralPool");
const CollateralPoolToken = artifacts.require("CollateralPoolToken");
const IERC20 = artifacts.require("IERC20");

enum ClaimType {
    POOL = "POOL",
    VAULT = "VAULT",
}

const MAX_EVENT_RETRY = 5;

export class AgentBot {
    constructor(
        public agent: Agent,
        public notifier: Notifier
    ) {}

    context = this.agent.context;
    eventDecoder = new Web3ContractEventDecoder({ assetManager: this.context.assetManager, priceChangeEmitter: this.context.priceChangeEmitter });
    latestProof: ConfirmedBlockHeightExists.Proof | null = null;

    /**
     * Creates instance of AgentBot with newly created underlying address and with provided agent default settings.
     * Certain AgentBot properties are also stored in persistent state.
     * @param rootEm entity manager
     * @param context fasset agent bot context
     * @param ownerAddress agent's owner native address
     * @param agentSettingsConfig desired agent's initial setting
     * @param notifier
     * @returns instance of AgentBot class
     */
    static async create(
        rootEm: EM,
        context: IAssetAgentBotContext,
        ownerAddress: string,
        agentSettingsConfig: AgentBotDefaultSettings,
        notifier: Notifier
    ): Promise<AgentBot> {
        logger.info(`Starting to create agent for owner ${ownerAddress} with settings ${JSON.stringify(agentSettingsConfig)}.`);
        const lastBlock = await web3.eth.getBlockNumber();
        return await rootEm.transactional(async (em) => {
            const underlyingAddress = await context.wallet.createAccount();
            // send 10 XRP from owners account to activate agent's account
            await this.activateUnderlyingAccount(context, underlyingAddress);
            const settings = await context.assetManager.getSettings();
            if (settings.requireEOAAddressProof) {
                await this.proveEOAaddress(context, underlyingAddress, ownerAddress);
            }
            const agentSettings: AgentSettings = { underlyingAddressString: underlyingAddress, ...agentSettingsConfig };
            const agent = await Agent.create(context, ownerAddress, agentSettings);
            const agentEntity = new AgentEntity();
            agentEntity.chainId = context.chainInfo.chainId;
            agentEntity.chainSymbol = context.chainInfo.symbol;
            agentEntity.ownerAddress = agent.ownerAddress;
            agentEntity.vaultAddress = agent.vaultAddress;
            agentEntity.underlyingAddress = agent.underlyingAddress;
            agentEntity.active = true;
            agentEntity.currentEventBlock = lastBlock + 1;
            agentEntity.collateralPoolAddress = agent.collateralPool.address;
            agentEntity.dailyProofState = DailyProofState.OBTAINED_PROOF;
            em.persist(agentEntity);
            logger.info(
                `Agent ${agent.vaultAddress} was created by owner ${agent.ownerAddress} with underlying address ${agent.underlyingAddress} and collateral pool address ${agent.collateralPool.address}.`
            );
            return new AgentBot(agent, notifier);
        });
    }

    /**
     * This method fixes the underlying address to be used by given AgentBot owner.
     * @param context fasset agent bot context
     * @param underlyingAddress agent's underlying address
     * @param ownerAddress agent's owner native address
     */
    static async proveEOAaddress(context: IAssetAgentBotContext, underlyingAddress: string, ownerAddress: string): Promise<void> {
        // 1 = smallest possible amount (as in 1 satoshi or 1 drop)
        const txHash = await context.wallet.addTransaction(underlyingAddress, underlyingAddress, 1, PaymentReference.addressOwnership(ownerAddress));
        await context.blockchainIndexer.waitForUnderlyingTransactionFinalization(txHash);
        const proof = await context.attestationProvider.provePayment(txHash, underlyingAddress, underlyingAddress);
        await context.assetManager.proveUnderlyingAddressEOA(web3DeepNormalize(proof), { from: ownerAddress });
    }

    /**
     * Creates instance of AgentBot from persistent state.
     * @param context fasset agent bot context
     * @param agentEntity stored agent entity
     * @param notifier
     * @returns instance of AgentBot class
     */
    static async fromEntity(context: IAssetAgentBotContext, agentEntity: AgentEntity, notifier: Notifier): Promise<AgentBot> {
        logger.info(`Starting to recreate agent ${agentEntity.vaultAddress} from DB for owner ${agentEntity.ownerAddress}.`);
        const agentVault = await AgentVault.at(agentEntity.vaultAddress);
        // get collateral pool
        const collateralPool = await CollateralPool.at(agentEntity.collateralPoolAddress);
        // get pool token
        const poolTokenAddress = await collateralPool.poolToken();
        const collateralPoolToken = await CollateralPoolToken.at(poolTokenAddress);
        // agent
        const agent = new Agent(context, agentEntity.ownerAddress, agentVault, collateralPool, collateralPoolToken, agentEntity.underlyingAddress);
        logger.info(
            `Agent ${agent.vaultAddress} was restored from DB by owner ${agent.ownerAddress} with underlying address ${agent.underlyingAddress} and collateral pool address ${agent.collateralPool.address}.`
        );
        return new AgentBot(agent, notifier);
    }

    /**
     * Activates agent's underlying XRP account by depositing 10 XRP from owner's underlying.
     * @param context fasset agent bot context
     * @param agentUnderlyingAddress agent's underlying address
     */
    static async activateUnderlyingAccount(context: IAssetAgentBotContext, agentUnderlyingAddress: string): Promise<void> {
        const ownerAddress = requireSecret("owner.native_address");
        try {
            if (![SourceId.XRP, SourceId.testXRP].includes(context.chainInfo.chainId)) return;
            const starterAmount = XRP_ACTIVATE_BALANCE;
            const ownerUnderlyingAddress = requireSecret("owner.underlying_address");
            const reference = requireSecret("owner.native_address");
            const txHash = await context.wallet.addTransaction(ownerUnderlyingAddress, agentUnderlyingAddress, starterAmount, reference);
            const transaction = await context.blockchainIndexer.waitForUnderlyingTransactionFinalization(txHash);
            /* istanbul ignore next */
            if (!transaction || transaction?.status != TX_SUCCESS) {
                throw new Error(`Could not activate or verify new XRP account with transaction ${txHash}`);
            }
            logger.info(`Owner ${ownerAddress} activated underlying address ${agentUnderlyingAddress} with transaction ${txHash}.`);
        } catch (error) {
            logger.error(`Owner ${ownerAddress} couldn't activate underlying address ${agentUnderlyingAddress}: ${error}`);
            throw new Error(`Could not activate or verify new XRP account ${agentUnderlyingAddress}`);
        }
    }

    /**
     * This is the main method, where "automatic" logic is gathered. In every step it firstly collects unhandled events and runs through them and handles them appropriately.
     * Secondly it checks if there are any redemptions in persistent storage, that needs to be handled.
     * Thirdly, it checks if there are any actions ready to be handled for AgentBot in persistent state (such actions that need announcement beforehand or that are time locked).
     * Lastly, it checks if there are any daily tasks that need to be handled (like mintings or redemptions caught in corner case).
     * @param rootEm entity manager
     */
    async runStep(rootEm: EM): Promise<void> {
        await this.troubleshootEvents(rootEm);
        await this.handleEvents(rootEm);
        await this.handleOpenRedemptions(rootEm);
        await this.handleAgentsWaitingsAndCleanUp(rootEm);
        await this.handleDailyTasks(rootEm);
    }

    async troubleshootEvents(rootEm: EM): Promise<void> {
        try {
            const agentEnt = await rootEm.findOneOrFail(AgentEntity, { vaultAddress: this.agent.vaultAddress } as FilterQuery<AgentEntity>);
            await agentEnt.events.init();
            for (const event of agentEnt.unhandledEvents().sort(eventOrder)) {
                await rootEm
                    .transactional(async (em) => {
                        const fullEvent = await this.getEventFromEntity(event)!;
                        await this.handleEvent(em, fullEvent!);
                        agentEnt.events.remove(event);
                    })
                    .catch(async (error) => {
                        event.retries += 1;
                        if (event.retries > MAX_EVENT_RETRY) {
                            agentEnt.events.remove(event);
                        }
                        await rootEm.persist(agentEnt).flush();
                        console.error(`Error troubleshooting handling of event with id ${event.id} for agent ${this.agent.vaultAddress}: ${error}`);
                        logger.error(`Agent ${this.agent.vaultAddress} run into error while handling an event: ${error}`);
                    });
            }
        } catch (error) {
            console.error(`Error troubleshooting events for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while troubleshooting events: ${error}`);
        }
    }

    async getEventFromEntity(event: Event): Promise<EvmEvent | undefined> {
        const encodedVaultAddress = web3.eth.abi.encodeParameter("address", this.agent.vaultAddress);
        const events = [];
        const logsAssetManager = await web3.eth.getPastLogs({
            address: this.agent.assetManager.address,
            fromBlock: event.blockNumber,
            toBlock: event.blockNumber,
            topics: [null, encodedVaultAddress],
        });
        const logsFtsoManager = await web3.eth.getPastLogs({
            address: this.context.priceChangeEmitter.address,
            fromBlock: event.blockNumber,
            toBlock: event.blockNumber,
            topics: [null],
        });
        events.push(...this.eventDecoder.decodeEvents(logsAssetManager));
        events.push(...this.eventDecoder.decodeEvents(logsFtsoManager));
        for (const _event of events) {
            if (_event.transactionIndex === event.transactionIndex && _event.logIndex === event.logIndex) {
                return _event;
            }
        }
    }

    /**
     * Performs appropriate actions according to received events.
     * @param rootEm entity manager
     */
    async handleEvents(rootEm: EM): Promise<void> {
        try {
            const agentEnt = await rootEm.findOneOrFail(AgentEntity, { vaultAddress: this.agent.vaultAddress } as FilterQuery<AgentEntity>);
            await agentEnt.events.init();
            const lastEventRead = agentEnt.lastEventRead();
            let events = await this.readNewEvents(rootEm);
            if (lastEventRead !== undefined) {
                events = events.filter((event) => eventOrder(event, lastEventRead) > 0);
            }
            for (const event of events) {
                await rootEm
                    .transactional(async (em) => {
                        // log event is handled here! Transaction committing should be done at the last possible step!
                        agentEnt.addNewEvent(new Event(agentEnt, event, true));
                        agentEnt.currentEventBlock = event.blockNumber;
                        // handle the event
                        await this.handleEvent(em, event);
                    })
                    .catch(async (error) => {
                        agentEnt.addNewEvent(new Event(agentEnt, event, false));
                        await rootEm.persist(agentEnt).flush();
                        console.error(`Error handling event ${event.signature} for agent ${this.agent.vaultAddress}: ${error}`);
                        logger.error(`Agent ${this.agent.vaultAddress} run into error while handling an event: ${error}`);
                    });
            }
        } catch (error) {
            console.error(`Error handling events for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling events: ${error}`);
        }
    }

    async handleEvent(em: EM, event: EvmEvent): Promise<void> {
        if (eventIs(event, this.context.assetManager, "CollateralReserved")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'CollateralReserved' with data ${formatArgs(event.args)}.`);
            this.mintingStarted(em, event.args);
        } else if (eventIs(event, this.context.assetManager, "CollateralReservationDeleted")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'CollateralReservationDeleted' with data ${formatArgs(event.args)}.`);
            const minting = await this.findMinting(em, event.args.collateralReservationId);
            this.mintingExecuted(minting, false);
        } else if (eventIs(event, this.context.assetManager, "MintingExecuted")) {
            if (!event.args.collateralReservationId.isZero()) {
                logger.info(`Agent ${this.agent.vaultAddress} received event 'MintingExecuted' with data ${formatArgs(event.args)}.`);
                const minting = await this.findMinting(em, event.args.collateralReservationId);
                this.mintingExecuted(minting, true);
            }
        } else if (eventIs(event, this.context.assetManager, "RedemptionRequested")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'RedemptionRequested' with data ${formatArgs(event.args)}.`);
            this.redemptionStarted(em, event.args);
        } else if (eventIs(event, this.context.assetManager, "RedemptionDefault")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'RedemptionDefault' with data ${formatArgs(event.args)}.`);
            this.notifier.sendRedemptionDefaulted(event.args.requestId.toString(), event.args.redeemer, event.args.agentVault);
        } else if (eventIs(event, this.context.assetManager, "RedemptionPerformed")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'RedemptionPerformed' with data ${formatArgs(event.args)}.`);
            await this.redemptionFinished(em, event.args.requestId, event.args.agentVault);
            this.notifier.sendRedemptionWasPerformed(event.args.requestId, event.args.redeemer, event.args.agentVault);
        } else if (eventIs(event, this.context.assetManager, "RedemptionPaymentFailed")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'RedemptionPaymentFailed' with data ${formatArgs(event.args)}.`);
            await this.redemptionFinished(em, event.args.requestId, event.args.agentVault);
            this.notifier.sendRedemptionFailedOrBlocked(
                event.args.requestId.toString(),
                event.args.transactionHash,
                event.args.redeemer,
                event.args.agentVault,
                event.args.failureReason
            );
        } else if (eventIs(event, this.context.assetManager, "RedemptionPaymentBlocked")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'RedemptionPaymentBlocked' with data ${formatArgs(event.args)}.`);
            await this.redemptionFinished(em, event.args.requestId, event.args.agentVault);
            this.notifier.sendRedemptionFailedOrBlocked(
                event.args.requestId.toString(),
                event.args.transactionHash,
                event.args.redeemer,
                event.args.agentVault
            );
        } else if (eventIs(event, this.context.assetManager, "AgentDestroyed")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'AgentDestroyed' with data ${formatArgs(event.args)}.`);
            await this.handleAgentDestruction(em, event.args.agentVault);
        } else if (eventIs(event, this.context.priceChangeEmitter, "PriceEpochFinalized")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'PriceEpochFinalized' with data ${formatArgs(event.args)}.`);
            await this.checkAgentForCollateralRatiosAndTopUp();
        } else if (eventIs(event, this.context.assetManager, "AgentInCCB")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'AgentInCCB' with data ${formatArgs(event.args)}.`);
            this.notifier.sendCCBAlert(event.args.agentVault, event.args.timestamp);
        } else if (eventIs(event, this.context.assetManager, "LiquidationStarted")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'LiquidationStarted' with data ${formatArgs(event.args)}.`);
            this.notifier.sendLiquidationStartAlert(event.args.agentVault, event.args.timestamp);
        } else if (eventIs(event, this.context.assetManager, "LiquidationPerformed")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'LiquidationPerformed' with data ${formatArgs(event.args)}.`);
            this.notifier.sendLiquidationWasPerformed(event.args.agentVault, event.args.valueUBA);
        } else if (eventIs(event, this.context.assetManager, "UnderlyingBalanceTooLow")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'UnderlyingBalanceTooLow' with data ${formatArgs(event.args)}.`);
            this.notifier.sendFullLiquidationAlert(event.args.agentVault);
        } else if (eventIs(event, this.context.assetManager, "DuplicatePaymentConfirmed")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'DuplicatePaymentConfirmed' with data ${formatArgs(event.args)}.`);
            this.notifier.sendFullLiquidationAlert(event.args.agentVault, event.args.transactionHash1, event.args.transactionHash2);
        } else if (eventIs(event, this.context.assetManager, "IllegalPaymentConfirmed")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'IllegalPaymentConfirmed' with data ${formatArgs(event.args)}.`);
            this.notifier.sendFullLiquidationAlert(event.args.agentVault, event.args.transactionHash);
        }
    }

    /**
     * Checks is there are any new events from assetManager.
     * @param em entity manager
     * @returns list of EvmEvents
     */
    async readNewEvents(em: EM): Promise<EvmEvent[]> {
        const agentEnt = await em.findOneOrFail(AgentEntity, { vaultAddress: this.agent.vaultAddress } as FilterQuery<AgentEntity>);
        logger.info(`Agent ${this.agent.vaultAddress} started reading native events FROM block ${agentEnt.currentEventBlock}`);
        // get all logs for this agent
        const nci = this.context.nativeChainInfo;
        const lastBlock = (await web3.eth.getBlockNumber()) - nci.finalizationBlocks;
        const events: EvmEvent[] = [];
        const encodedVaultAddress = web3.eth.abi.encodeParameter("address", this.agent.vaultAddress);
        for (let lastBlockRead = agentEnt.currentEventBlock; lastBlockRead <= lastBlock; lastBlockRead += nci.readLogsChunkSize) {
            const logsAssetManager = await web3.eth.getPastLogs({
                address: this.agent.assetManager.address,
                fromBlock: lastBlockRead,
                toBlock: Math.min(lastBlockRead + nci.readLogsChunkSize - 1, lastBlock),
                topics: [null, encodedVaultAddress],
            });
            events.push(...this.eventDecoder.decodeEvents(logsAssetManager));
            const logsFtsoManager = await web3.eth.getPastLogs({
                address: this.context.priceChangeEmitter.address,
                fromBlock: lastBlockRead,
                toBlock: Math.min(lastBlockRead + nci.readLogsChunkSize - 1, lastBlock),
                topics: [null],
            });
            events.push(...this.eventDecoder.decodeEvents(logsFtsoManager));
        }
        // sort events first by their block numbers, then internally by their event index
        events.sort(eventOrder);
        logger.info(`Agent ${this.agent.vaultAddress} finished reading native events TO block ${lastBlock}`);
        return events;
    }

    /**
     * Once a day checks corner cases and claims.
     * @param rootEm entity manager
     */
    async handleDailyTasks(rootEm: EM): Promise<void> {
        const agentEnt = await rootEm.findOneOrFail(AgentEntity, { vaultAddress: this.agent.vaultAddress } as FilterQuery<AgentEntity>);
        const latestBlock = await latestUnderlyingBlock(this.context.blockchainIndexer);
        /* istanbul ignore else */
        if (latestBlock) {
            logger.info(
                `Agent ${
                    this.agent.vaultAddress
                } checks if daily task need to be handled. List time checked: ${agentEnt.dailyTasksTimestamp.toString()}. Latest block: ${
                    latestBlock.number
                }, ${latestBlock.timestamp}.`
            );
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} could not retrieve latest block in handleDailyTasks.`);
            return;
        }
        if (
            latestBlock &&
            toBN(latestBlock.timestamp)
                .sub(toBN(agentEnt.dailyTasksTimestamp))
                .gtn(1 * DAYS)
        ) {
            if (agentEnt.dailyProofState === DailyProofState.OBTAINED_PROOF) {
                logger.info(`Agent ${this.agent.vaultAddress} is trying to request confirmed block heigh exists proof daily tasks.`);
                const request = await this.context.attestationProvider.requestConfirmedBlockHeightExistsProof(
                    await attestationWindowSeconds(this.context.assetManager)
                );
                if (request) {
                    agentEnt.dailyProofState = DailyProofState.WAITING_PROOF;
                    agentEnt.dailyProofRequestRound = request.round;
                    agentEnt.dailyProofRequestData = request.data;
                    logger.info(
                        `Agent ${this.agent.vaultAddress} requested confirmed block heigh exists proof for daily tasks: dailyProofRequestRound ${request.round} and dailyProofRequestData ${request.data}`
                    );
                    await rootEm.persistAndFlush(agentEnt);
                } else {
                    // else cannot prove request yet
                    logger.info(`Agent ${this.agent.vaultAddress} cannot yet request confirmed block heigh exists for proof daily tasks`);
                }
            } else {
                // agentEnt.dailyProofState === DailyProofState.WAITING_PROOF
                logger.info(
                    `Agent ${this.agent.vaultAddress} is trying to obtain confirmed block heigh exists proof daily tasks in round ${agentEnt.dailyProofRequestRound} and data ${agentEnt.dailyProofRequestData}.`
                );
                const proof = await this.context.attestationProvider.obtainConfirmedBlockHeightExistsProof(
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    agentEnt.dailyProofRequestRound!,
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    agentEnt.dailyProofRequestData!
                );
                if (proof === AttestationNotProved.NOT_FINALIZED) {
                    logger.info(
                        `Agent ${this.agent.vaultAddress}: proof not yet finalized for confirmed block heigh exists proof daily tasks in round ${agentEnt.dailyProofRequestRound} and data ${agentEnt.dailyProofRequestData}.`
                    );
                    return;
                }
                if (attestationProved(proof)) {
                    logger.info(
                        `Agent ${this.agent.vaultAddress} obtained confirmed block heigh exists proof daily tasks in round ${agentEnt.dailyProofRequestRound} and data ${agentEnt.dailyProofRequestData}.`
                    );
                    this.latestProof = proof;

                    agentEnt.dailyProofState = DailyProofState.OBTAINED_PROOF;
                    await this.handleCornerCases(rootEm);
                    await this.checkForClaims();
                    agentEnt.dailyTasksTimestamp = toBN(latestBlock.timestamp);
                    await rootEm.persistAndFlush(agentEnt);
                } else {
                    logger.info(
                        `Agent ${this.agent.vaultAddress} cannot obtain confirmed block heigh exists proof daily tasks in round ${agentEnt.dailyProofRequestRound} and data ${agentEnt.dailyProofRequestData}.`
                    );
                    this.notifier.sendNoProofObtained(
                        agentEnt.vaultAddress,
                        null,
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        agentEnt.dailyProofRequestRound!,
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        agentEnt.dailyProofRequestData!
                    );
                    // request new block height proof
                    agentEnt.dailyProofState = DailyProofState.OBTAINED_PROOF;
                    await rootEm.persistAndFlush(agentEnt);
                }
            }
        }
        logger.info(`Agent ${this.agent.vaultAddress} finished checking if daily task need to be handled.`);
    }

    /**
     * Checks if there are any claims for agent vault and collateral pool.
     */
    async checkForClaims(): Promise<void> {
        // FTSO rewards
        await this.checkFTSORewards(ClaimType.VAULT);
        await this.checkFTSORewards(ClaimType.POOL);
        // airdrop distribution rewards
        await this.checkAirdropClaims(ClaimType.VAULT);
        await this.checkAirdropClaims(ClaimType.POOL);
    }

    async checkFTSORewards(type: ClaimType) {
        try {
            logger.info(`Agent ${this.agent.vaultAddress} started checking for FTSO rewards.`);
            const IFtsoRewardManager = artifacts.require("IFtsoRewardManager");
            const ftsoRewardManager = await IFtsoRewardManager.at(await this.context.addressUpdater.getContractAddress("FtsoRewardManager"));
            const addressToClaim = type === ClaimType.VAULT ? this.agent.vaultAddress : this.agent.collateralPool.address;
            const notClaimedRewards: BN[] = await ftsoRewardManager.getEpochsWithUnclaimedRewards(addressToClaim);
            if (notClaimedRewards.length > 0) {
                const unClaimedEpoch = notClaimedRewards[notClaimedRewards.length - 1];
                logger.info(`Agent ${this.agent.vaultAddress} is claiming Ftso rewards for ${addressToClaim} for epochs ${unClaimedEpoch.toString()}`);
                if (type === ClaimType.VAULT) {
                    await this.agent.agentVault.claimFtsoRewards(ftsoRewardManager.address, unClaimedEpoch, addressToClaim, {
                        from: this.agent.ownerAddress,
                    });
                } else {
                    await this.agent.collateralPool.claimFtsoRewards(ftsoRewardManager.address, unClaimedEpoch, { from: this.agent.ownerAddress });
                }
            }
            logger.info(`Agent ${this.agent.vaultAddress} finished checking for claims.`);
        } catch (error) {
            console.error(`Error handling FTSO rewards for ${type} for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling FTSO rewards for ${type}: ${error}`);
        }
    }

    async checkAirdropClaims(type: ClaimType) {
        try {
            logger.info(`Agent ${this.agent.vaultAddress} started checking for airdrop distribution.`);
            const IDistributionToDelegators = artifacts.require("IDistributionToDelegators");
            const distributionToDelegators = await IDistributionToDelegators.at(
                await this.context.addressUpdater.getContractAddress("DistributionToDelegators")
            );
            const addressToClaim = type === ClaimType.VAULT ? this.agent.vaultAddress : this.agent.collateralPool.address;
            const { 1: endMonth } = await distributionToDelegators.getClaimableMonths({ from: addressToClaim });
            const claimable = await distributionToDelegators.getClaimableAmountOf(addressToClaim, endMonth);
            if (toBN(claimable).gtn(0)) {
                logger.info(`Agent ${this.agent.vaultAddress} is claiming airdrop distribution for ${addressToClaim} for month ${endMonth}.`);
                if (type === ClaimType.VAULT) {
                    await this.agent.agentVault.claimAirdropDistribution(distributionToDelegators.address, endMonth, addressToClaim, {
                        from: this.agent.ownerAddress,
                    });
                } else {
                    await this.agent.collateralPool.claimAirdropDistribution(distributionToDelegators.address, endMonth, { from: this.agent.ownerAddress });
                }
            }
            logger.info(`Agent ${this.agent.vaultAddress} finished checking for airdrop distribution.`);
        } catch (error) {
            console.error(`Error handling airdrop distribution for ${type} for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling airdrop distribution for ${type}: ${error}`);
        }
    }

    /**
     * Checks if any minting or redemption is stuck in corner case.
     * @param rootEm entity manager
     */
    async handleCornerCases(rootEm: EM): Promise<void> {
        try {
            logger.info(`Agent ${this.agent.vaultAddress} started handling corner cases.`);
            await this.handleOpenMintings(rootEm);
            await this.handleOpenRedemptionsForCornerCase(rootEm);
            logger.info(`Agent ${this.agent.vaultAddress} finished handling corner cases.`);
        } catch (error) {
            console.error(`Error handling corner cases for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling corner cases: ${error}`);
        }
    }

    /**
     * Checks and handles if there are any AgentBot actions (withdraw, exit available list, update AgentBot setting) waited to be executed due to required announcement or time lock.
     * @param rootEm entity manager
     */
    async handleAgentsWaitingsAndCleanUp(rootEm: EM): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} started handling 'handleAgentsWaitingsAndCleanUp'.`);
        await rootEm.transactional(async (em) => {
            const agentEnt = await em.findOneOrFail(AgentEntity, { vaultAddress: this.agent.vaultAddress } as FilterQuery<AgentEntity>);
            const latestTimestamp = await latestBlockTimestampBN();
            if (toBN(agentEnt.waitingForDestructionTimestamp).gt(BN_ZERO)) {
                logger.info(`Agent ${this.agent.vaultAddress} is waiting for destruction.`);
                // agent waiting for destruction
                if (toBN(agentEnt.waitingForDestructionTimestamp).lte(latestTimestamp)) {
                    // agent can be destroyed
                    await this.agent.destroy();
                    agentEnt.waitingForDestructionTimestamp = BN_ZERO;
                    await this.handleAgentDestruction(em, agentEnt.vaultAddress);
                } else {
                    logger.info(
                        `Agent ${
                            this.agent.vaultAddress
                        } cannot be destroyed. Allowed at ${agentEnt.waitingForDestructionTimestamp.toString()}. Current ${latestTimestamp.toString()}.`
                    );
                }
            }
            // vault collateral withdrawal
            if (toBN(agentEnt.withdrawalAllowedAtTimestamp).gt(BN_ZERO)) {
                const successOrExpired = await this.withdrawCollateral(
                    toBN(agentEnt.withdrawalAllowedAtTimestamp),
                    toBN(agentEnt.withdrawalAllowedAtAmount),
                    latestTimestamp,
                    ClaimType.VAULT
                );
                if (successOrExpired) {
                    agentEnt.withdrawalAllowedAtTimestamp = BN_ZERO;
                    agentEnt.withdrawalAllowedAtAmount = "";
                }
            }
            // pool token redemption
            if (toBN(agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp).gt(BN_ZERO)) {
                const successOrExpired = await this.withdrawCollateral(
                    toBN(agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp),
                    toBN(agentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount),
                    latestTimestamp,
                    ClaimType.POOL
                );
                if (successOrExpired) {
                    agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp = BN_ZERO;
                    agentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount = "";
                }
            }
            //Agent settings update
            //Agent update feeBIPS
            if (toBN(agentEnt.agentSettingUpdateValidAtFeeBIPS).gt(BN_ZERO)) {
                const updatedOrExpired = await this.updateAgentSettings(toBN(agentEnt.agentSettingUpdateValidAtFeeBIPS), "feeBIPS", latestTimestamp);
                if (updatedOrExpired) agentEnt.agentSettingUpdateValidAtFeeBIPS = BN_ZERO;
            }
            //Agent update poolFeeShareBIPS
            if (toBN(agentEnt.agentSettingUpdateValidAtPoolFeeShareBIPS).gt(BN_ZERO)) {
                const updatedOrExpired = await this.updateAgentSettings(
                    toBN(agentEnt.agentSettingUpdateValidAtPoolFeeShareBIPS),
                    "poolFeeShareBIPS",
                    latestTimestamp
                );
                if (updatedOrExpired) agentEnt.agentSettingUpdateValidAtPoolFeeShareBIPS = BN_ZERO;
            }
            //Agent update mintingVaultCollateralRatioBIPS
            if (toBN(agentEnt.agentSettingUpdateValidAtMintingVaultCrBIPS).gt(BN_ZERO)) {
                const updatedOrExpired = await this.updateAgentSettings(
                    toBN(agentEnt.agentSettingUpdateValidAtMintingVaultCrBIPS),
                    "mintingVaultCollateralRatioBIPS",
                    latestTimestamp
                );
                if (updatedOrExpired) agentEnt.agentSettingUpdateValidAtMintingVaultCrBIPS = BN_ZERO;
            }
            //Agent update mintingPoolCollateralRatioBIPS
            if (toBN(agentEnt.agentSettingUpdateValidAtMintingPoolCrBIPS).gt(BN_ZERO)) {
                const updatedOrExpired = await this.updateAgentSettings(
                    toBN(agentEnt.agentSettingUpdateValidAtMintingPoolCrBIPS),
                    "mintingPoolCollateralRatioBIPS",
                    latestTimestamp
                );
                if (updatedOrExpired) agentEnt.agentSettingUpdateValidAtMintingPoolCrBIPS = BN_ZERO;
            }
            //Agent update buyFAssetByAgentFactorBIPS
            if (toBN(agentEnt.agentSettingUpdateValidAtBuyFAssetByAgentFactorBIPS).gt(BN_ZERO)) {
                const updatedOrExpired = await this.updateAgentSettings(
                    toBN(agentEnt.agentSettingUpdateValidAtBuyFAssetByAgentFactorBIPS),
                    "buyFAssetByAgentFactorBIPS",
                    latestTimestamp
                );
                if (updatedOrExpired) agentEnt.agentSettingUpdateValidAtBuyFAssetByAgentFactorBIPS = BN_ZERO;
            }
            //Agent update poolExitCollateralRatioBIPS
            if (toBN(agentEnt.agentSettingUpdateValidAtPoolExitCrBIPS).gt(BN_ZERO)) {
                const updatedOrExpired = await this.updateAgentSettings(
                    toBN(agentEnt.agentSettingUpdateValidAtPoolExitCrBIPS),
                    "poolExitCollateralRatioBIPS",
                    latestTimestamp
                );
                if (updatedOrExpired) agentEnt.agentSettingUpdateValidAtPoolExitCrBIPS = BN_ZERO;
            }
            //Agent update poolTopupCollateralRatioBIPS
            if (toBN(agentEnt.agentSettingUpdateValidAtPoolTopupCrBIPS).gt(BN_ZERO)) {
                const updatedOrExpired = await this.updateAgentSettings(
                    toBN(agentEnt.agentSettingUpdateValidAtPoolTopupCrBIPS),
                    "poolTopupCollateralRatioBIPS",
                    latestTimestamp
                );
                if (updatedOrExpired) agentEnt.agentSettingUpdateValidAtPoolTopupCrBIPS = BN_ZERO;
            }
            //Agent update poolTopupTokenPriceFactorBIPS
            if (toBN(agentEnt.agentSettingUpdateValidAtPoolTopupTokenPriceFactorBIPS).gt(BN_ZERO)) {
                const updatedOrExpired = await this.updateAgentSettings(
                    toBN(agentEnt.agentSettingUpdateValidAtPoolTopupTokenPriceFactorBIPS),
                    "poolTopupTokenPriceFactorBIPS",
                    latestTimestamp
                );
                if (updatedOrExpired) agentEnt.agentSettingUpdateValidAtPoolTopupTokenPriceFactorBIPS = BN_ZERO;
            }
            if (
                toBN(agentEnt.exitAvailableAllowedAtTimestamp).gt(BN_ZERO) ||
                (toBN(agentEnt.exitAvailableAllowedAtTimestamp).gt(BN_ZERO) && agentEnt.waitingForDestructionCleanUp)
            ) {
                // agent can exit available
                await this.exitAvailable(agentEnt);
            } else if (
                agentEnt.waitingForDestructionCleanUp &&
                (toBN(agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp).gt(BN_ZERO) ||
                    toBN(agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp).gt(BN_ZERO))
            ) {
                logger.info(`Agent ${this.agent.vaultAddress} is waiting for clean up before destruction.`);

                // vault collateral withdrawal
                if (toBN(agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp).gt(BN_ZERO)) {
                    const successOrExpired = await this.withdrawCollateral(
                        toBN(agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp),
                        toBN(agentEnt.destroyVaultCollateralWithdrawalAllowedAtAmount),
                        latestTimestamp,
                        ClaimType.VAULT
                    );
                    if (successOrExpired) {
                        agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp = BN_ZERO;
                        agentEnt.destroyVaultCollateralWithdrawalAllowedAtAmount = "";
                    }
                }
                // pool token redemption
                if (toBN(agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp).gt(BN_ZERO)) {
                    const successOrExpired = await this.withdrawCollateral(
                        toBN(agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp),
                        toBN(agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtAmount),
                        latestTimestamp,
                        ClaimType.POOL
                    );
                    if (successOrExpired) {
                        agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp = BN_ZERO;
                        agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtAmount = "";
                    }
                }
            } else if (agentEnt.waitingForDestructionCleanUp) {
                logger.info(`Agent ${this.agent.vaultAddress} is checking if clean up before destruction is complete.`);
                // agent checks if clean up is complete
                // withdraw and self close pool fees
                const poolFeeBalance = await this.agent.poolFeeBalance();
                if (poolFeeBalance.gt(BN_ZERO)) {
                    await this.agent.withdrawPoolFees(poolFeeBalance);
                    await this.agent.selfClose(poolFeeBalance);
                    logger.info(`Agent ${this.agent.vaultAddress} withdrew and self closed pool fees ${poolFeeBalance.toString()}.`);
                }
                // check poolTokens and vaultCollateralBalance
                const agentInfoForAnnounce = await this.agent.getAgentInfo();
                const freeVaultCollateralBalance = toBN(agentInfoForAnnounce.freeVaultCollateralWei);
                if (freeVaultCollateralBalance.gt(BN_ZERO)) {
                    // announce withdraw class 1
                    agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp =
                        await this.agent.announceVaultCollateralWithdrawal(freeVaultCollateralBalance);
                    agentEnt.destroyVaultCollateralWithdrawalAllowedAtAmount = freeVaultCollateralBalance.toString();
                    logger.info(
                        `Agent ${this.agent.vaultAddress} announced vault collateral withdrawal ${freeVaultCollateralBalance.toString()} at ${
                            agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp
                        }.`
                    );
                }
                // check poolTokens
                const poolTokenBalance = toBN(await this.agent.collateralPoolToken.balanceOf(this.agent.vaultAddress));
                const agentInfo = await this.agent.getAgentInfo();
                if (
                    poolTokenBalance.gt(BN_ZERO) &&
                    toBN(agentInfo.mintedUBA).eq(BN_ZERO) &&
                    toBN(agentInfo.redeemingUBA).eq(BN_ZERO) &&
                    toBN(agentInfo.reservedUBA).eq(BN_ZERO) &&
                    toBN(agentInfo.poolRedeemingUBA).eq(BN_ZERO)
                ) {
                    // announce redeem pool tokens and wait for others to do so (pool needs to be empty)
                    agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp = await this.agent.announcePoolTokenRedemption(poolTokenBalance);
                    agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtAmount = poolTokenBalance.toString();
                    logger.info(
                        `Agent ${this.agent.vaultAddress} announced pool token redemption ${poolTokenBalance.toString()} at ${
                            agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp
                        }.`
                    );
                }
                const agentInfoForDestroy = await this.agent.getAgentInfo();
                const totalPoolTokens = toBN(await this.agent.collateralPoolToken.totalSupply());
                //and wait for others to redeem
                if (
                    totalPoolTokens.eq(BN_ZERO) &&
                    toBN(agentInfoForDestroy.mintedUBA).eq(BN_ZERO) &&
                    toBN(agentInfoForDestroy.redeemingUBA).eq(BN_ZERO) &&
                    toBN(agentInfoForDestroy.reservedUBA).eq(BN_ZERO) &&
                    toBN(agentInfoForDestroy.poolRedeemingUBA).eq(BN_ZERO)
                ) {
                    // agent checks if clean is complete, agent can announce destroy
                    const destroyAllowedAt = await this.agent.announceDestroy();
                    agentEnt.waitingForDestructionTimestamp = destroyAllowedAt;
                    agentEnt.waitingForDestructionCleanUp = false;
                    this.notifier.sendAgentAnnounceDestroy(agentEnt.vaultAddress);
                    logger.info(`Agent ${this.agent.vaultAddress} was destroyed.`);
                } else {
                    if (toBN(agentInfoForDestroy.mintedUBA).gt(BN_ZERO)) {
                        logger.info(`Cannot destroy agent ${this.agent.vaultAddress}: Agent is still backing FAssets.`);
                    }
                    if (toBN(agentInfoForDestroy.redeemingUBA).gt(BN_ZERO) || toBN(agentInfoForDestroy.poolRedeemingUBA).gt(BN_ZERO)) {
                        logger.info(`Cannot destroy agent ${this.agent.vaultAddress}: Agent is still redeeming FAssets.`);
                    }
                    if (toBN(agentInfoForDestroy.reservedUBA).gt(BN_ZERO)) {
                        logger.info(`Cannot destroy agent ${this.agent.vaultAddress}: Agent has some locked collateral by collateral reservation.`);
                    }
                    /* istanbul ignore else */
                    if (toBN(totalPoolTokens).gt(BN_ZERO)) {
                        logger.info(`Cannot destroy agent ${this.agent.vaultAddress}: Total supply of collateral pool tokens is not 0.`);
                    }
                }
            }
            // confirm underlying withdrawal
            if (toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).gt(BN_ZERO)) {
                logger.info(`Agent ${this.agent.vaultAddress} is waiting for confirming underlying withdrawal.`);
                // agent waiting for underlying withdrawal
                if (agentEnt.underlyingWithdrawalConfirmTransaction.length) {
                    const announcedUnderlyingConfirmationMinSeconds = toBN(
                        (await this.context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds
                    );
                    if (toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).add(announcedUnderlyingConfirmationMinSeconds).lt(latestTimestamp)) {
                        // agent can confirm underlying withdrawal
                        await this.agent.confirmUnderlyingWithdrawal(agentEnt.underlyingWithdrawalConfirmTransaction);
                        this.notifier.sendConfirmWithdrawUnderlying(agentEnt.vaultAddress);
                        logger.info(
                            `Agent ${this.agent.vaultAddress} confirmed underlying withdrawal transaction ${agentEnt.underlyingWithdrawalConfirmTransaction}.`
                        );
                        agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = BN_ZERO;
                        agentEnt.underlyingWithdrawalConfirmTransaction = "";
                    } else {
                        logger.info(
                            `Agent ${this.agent.vaultAddress} cannot yet confirm underlying withdrawal. Allowed at ${toBN(
                                agentEnt.underlyingWithdrawalAnnouncedAtTimestamp
                            )
                                .add(announcedUnderlyingConfirmationMinSeconds)
                                .toString()}. Current ${latestTimestamp.toString()}.`
                        );
                    }
                }
            }
            // cancel underlying withdrawal
            if (agentEnt.underlyingWithdrawalWaitingForCancelation) {
                logger.info(`Agent ${this.agent.vaultAddress} is waiting for canceling underlying withdrawal.`);
                const announcedUnderlyingConfirmationMinSeconds = toBN(
                    (await this.context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds
                );
                if (toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).add(announcedUnderlyingConfirmationMinSeconds).lt(latestTimestamp)) {
                    // agent can confirm cancel withdrawal announcement
                    await this.agent.cancelUnderlyingWithdrawal();
                    this.notifier.sendCancelWithdrawUnderlying(agentEnt.vaultAddress);
                    logger.info(
                        `Agent ${this.agent.vaultAddress} canceled underlying withdrawal transaction ${agentEnt.underlyingWithdrawalConfirmTransaction}.`
                    );
                    agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = BN_ZERO;
                    agentEnt.underlyingWithdrawalConfirmTransaction = "";
                    agentEnt.underlyingWithdrawalWaitingForCancelation = false;
                } else {
                    logger.info(
                        `Agent ${this.agent.vaultAddress} cannot yet cancel underlying withdrawal. Allowed at ${toBN(
                            agentEnt.underlyingWithdrawalAnnouncedAtTimestamp
                        ).toString()}. Current ${latestTimestamp.toString()}.`
                    );
                }
            }
            em.persist(agentEnt);
        });
        logger.info(`Agent ${this.agent.vaultAddress} finished handling 'handleAgentsWaitingsAndCleanUp'.`);
    }

    /**
     * AgentBot tries to withdraw vault collateral or redeem pool tokens
     * @param withdrawValidAt
     * @param withdrawAmount
     * @param latestTimestamp
     * @param type
     * @returns true if withdraw successful or time expired
     */
    async withdrawCollateral(withdrawValidAt: BN, withdrawAmount: BN, latestTimestamp: BN, type: ClaimType): Promise<boolean> {
        const desiredErrorIncludes = ["withdrawal: too late", "withdrawal: CR too low"];
        logger.info(`Agent ${this.agent.vaultAddress} is waiting to withdraw ${type} collateral.`);
        // agent waiting for pool token redemption
        if (toBN(withdrawValidAt).lte(latestTimestamp)) {
            // agent can withdraw vault collateral
            try {
                if (type === ClaimType.VAULT) {
                    await this.agent.withdrawVaultCollateral(withdrawAmount);
                    this.notifier.sendWithdrawVaultCollateral(this.agent.vaultAddress, withdrawAmount.toString());
                } else {
                    await this.agent.redeemCollateralPoolTokens(withdrawAmount);
                    this.notifier.sendRedeemCollateralPoolTokens(this.agent.vaultAddress, withdrawAmount.toString());
                }
                logger.info(`Agent ${this.agent.vaultAddress} withdrew ${type} collateral ${withdrawAmount.toString()}.`);
                return true;
            } catch (error) {
                if (error instanceof Error && findOneSubstring(error.message, desiredErrorIncludes)) {
                    this.notifier.sendAgentCannotWithdrawCollateral(this.agent.vaultAddress, withdrawAmount.toString(), type);
                    return true;
                }
                logger.error(`Agent ${this.agent.vaultAddress} run into error while withdrawing ${type} collateral: ${error}`);
            }
        } else {
            logger.info(
                `Agent ${
                    this.agent.vaultAddress
                } cannot withdraw ${type} collateral. Allowed at ${withdrawValidAt.toString()}. Current ${latestTimestamp.toString()}.`
            );
        }
        return false;
    }

    /**
     * AgentBot tries to update agent setting
     * @param settingValidAt setting update valid at
     * @param settingsName
     * @param latestTimestamp
     * @returns true if settings was updated or valid time expired
     */
    async updateAgentSettings(settingValidAt: BN, settingsName: string, latestTimestamp: BN): Promise<boolean> {
        const desiredSettingsUpdateErrorIncludes = "update not valid anymore";
        logger.info(`Agent ${this.agent.vaultAddress} is waiting for ${settingsName} agent setting update.`);
        // agent waiting for setting update
        if (toBN(settingValidAt).lte(latestTimestamp)) {
            // agent can update setting
            try {
                await this.agent.executeAgentSettingUpdate(settingsName);
                this.notifier.sendAgentSettingsUpdate(this.agent.vaultAddress, settingsName);
                logger.info(`Agent ${this.agent.vaultAddress} updated agent setting ${settingsName}.`);
                return true;
            } catch (error) {
                if (error instanceof Error && error.message.includes(desiredSettingsUpdateErrorIncludes)) {
                    this.notifier.sendAgentCannotUpdateSettingExpired(this.agent.vaultAddress, settingsName);
                    return true;
                }
                logger.error(`Agent ${this.agent.vaultAddress} run into error while updating setting ${settingsName}: ${error}`);
            }
        } else {
            logger.info(
                `Agent ${
                    this.agent.vaultAddress
                } cannot update agent setting ${settingsName}. Allowed at ${settingValidAt.toString()}. Current ${latestTimestamp.toString()}.`
            );
        }
        return false;
    }

    /**
     * AgentBot exits available if already allowed
     * @param agentEnt agent entity
     */
    async exitAvailable(agentEnt: AgentEntity) {
        logger.info(`Agent ${this.agent.vaultAddress} is waiting to exit available list.`);
        const latestTimestamp = await latestBlockTimestampBN();
        if (toBN(agentEnt.exitAvailableAllowedAtTimestamp).lte(latestTimestamp)) {
            await this.agent.exitAvailable();
            agentEnt.exitAvailableAllowedAtTimestamp = BN_ZERO;
            this.notifier.sendAgentExitedAvailable(agentEnt.vaultAddress);
            logger.info(`Agent ${this.agent.vaultAddress} exited available list.`);
        } else {
            logger.info(
                `Agent ${
                    this.agent.vaultAddress
                } cannot exit available list. Allowed at ${agentEnt.exitAvailableAllowedAtTimestamp.toString()}. Current ${latestTimestamp.toString()}.`
            );
        }
    }

    /**
     * Stores received collateral reservation as minting in persistent state.
     * @param em entity manager
     * @param request event's CollateralReserved arguments
     */
    mintingStarted(em: EM, request: EventArgs<CollateralReserved>): void {
        em.create(
            AgentMinting,
            {
                state: AgentMintingState.STARTED,
                agentAddress: this.agent.vaultAddress,
                agentUnderlyingAddress: this.agent.underlyingAddress,
                requestId: toBN(request.collateralReservationId),
                valueUBA: toBN(request.valueUBA),
                feeUBA: toBN(request.feeUBA),
                firstUnderlyingBlock: toBN(request.firstUnderlyingBlock),
                lastUnderlyingBlock: toBN(request.lastUnderlyingBlock),
                lastUnderlyingTimestamp: toBN(request.lastUnderlyingTimestamp),
                paymentReference: request.paymentReference,
            } as RequiredEntityData<AgentMinting>,
            { persist: true }
        );
        this.notifier.sendMintingStared(this.agent.vaultAddress, request.collateralReservationId.toString());
        logger.info(`Agent ${this.agent.vaultAddress} started minting ${request.collateralReservationId.toString()}.`);
    }

    /**
     * Returns minting by required id from persistent state.
     * @param em entity manager
     * @param requestId collateral reservation id
     * @returns instance of AgentMinting
     */
    async findMinting(em: EM, requestId: BN): Promise<AgentMinting> {
        const agentAddress = this.agent.vaultAddress;
        return await em.findOneOrFail(AgentMinting, { agentAddress, requestId } as FilterQuery<AgentMinting>);
    }

    /**
     * @param rootEm entity manager
     */
    async handleOpenMintings(rootEm: EM): Promise<void> {
        const openMintings = await this.openMintings(rootEm, true);
        logger.info(`Agent ${this.agent.vaultAddress} started handling open mintings #${openMintings.length}.`);
        for (const rd of openMintings) {
            await this.nextMintingStep(rootEm, rd.id);
        }
        logger.info(`Agent ${this.agent.vaultAddress} finished handling open mintings.`);
    }

    /**
     * Returns minting with state other than DONE.
     * @param em entity manager
     * @param onlyIds if true, only AgentMinting's entity ids are return
     * @return list of AgentMinting's instances
     */
    async openMintings(em: EM, onlyIds: boolean): Promise<AgentMinting[]> {
        let query = em.createQueryBuilder(AgentMinting);
        if (onlyIds) query = query.select("id");
        return await query
            .where({ agentAddress: this.agent.vaultAddress })
            .andWhere({ $not: { state: AgentMintingState.DONE } })
            .getResultList();
    }

    /**
     * Marks stored minting in persistent state as DONE.
     * @param minting AgentMinting entity
     * @param executed if true, notifies about executed minting, otherwise notifies about deleted minting
     */
    mintingExecuted(minting: AgentMinting, executed: boolean): void {
        minting.state = AgentMintingState.DONE;
        if (executed) {
            this.notifier.sendMintingExecuted(minting.agentAddress, minting.requestId.toString());
            logger.info(`Agent ${this.agent.vaultAddress} closed (executed) minting ${minting.requestId}.`);
        } else {
            this.notifier.sendMintingDeleted(minting.agentAddress, minting.requestId.toString());
            logger.info(`Agent ${this.agent.vaultAddress} closed (deleted) minting ${minting.requestId}.`);
        }
    }

    /**
     * Handles mintings stored in persistent state according to their state.
     * @param rootEm entity manager
     * @param id AgentMinting's entity id
     */
    async nextMintingStep(rootEm: EM, id: number): Promise<void> {
        await rootEm
            .transactional(async (em) => {
                const minting = await em.getRepository(AgentMinting).findOneOrFail({ id: Number(id) } as FilterQuery<AgentMinting>);
                logger.info(`Agent ${this.agent.vaultAddress} is handling open minting ${minting.requestId} in state ${minting.state}.`);
                switch (minting.state) {
                    case AgentMintingState.STARTED:
                        await this.checkForNonPaymentProofOrExpiredProofs(minting);
                        break;
                    case AgentMintingState.REQUEST_NON_PAYMENT_PROOF:
                        await this.checkNonPayment(minting);
                        break;
                    case AgentMintingState.REQUEST_PAYMENT_PROOF:
                        await this.checkPaymentAndExecuteMinting(minting);
                        break;
                    default:
                        console.error(`Minting state: ${minting.state} not supported`);
                        logger.error(
                            `Agent ${this.agent.vaultAddress} run into minting state ${
                                minting.state
                            } not supported for minting ${minting.requestId.toString()}.`
                        );
                }
            })
            .catch((error) => {
                console.error(`Error handling next minting step for minting ${id} agent ${this.agent.vaultAddress}: ${error}`);
                logger.error(`Agent ${this.agent.vaultAddress} run into error while handling handling next minting step for minting ${id}: ${error}`);
            });
    }

    /**
     * When minting is in state STARTED, it checks if underlying payment proof for collateral reservation expired in indexer.
     * If proof expired (corner case), it calls unstickMinting, sets the state of minting in persistent state as DONE and send notification to owner.
     * If proof exists, it checks if time for payment expired on underlying. If if did not expire, then it does nothing.
     * If time for payment expired, it checks via indexer if transaction for payment exists.
     * If it does exists, then it requests for payment proof - see requestPaymentProofForMinting().
     * If it does not exist, then it request non payment proof - see requestNonPaymentProofForMinting().
     * @param minting AgentMinting entity
     */
    async checkForNonPaymentProofOrExpiredProofs(minting: AgentMinting): Promise<void> {
        const proof = await this.checkProofExpiredInIndexer(toBN(minting.lastUnderlyingBlock), toBN(minting.lastUnderlyingTimestamp));
        if (proof) {
            // corner case: proof expires in indexer
            logger.info(
                `Agent ${this.agent.vaultAddress} is calling 'unstickMinting' ${minting.requestId} with proof ${JSON.stringify(web3DeepNormalize(proof))}.`
            );
            const settings = await this.context.assetManager.getSettings();
            const burnNats = toBN(
                (await this.agent.getPoolCollateralPrice())
                    .convertUBAToTokenWei(toBN(minting.valueUBA))
                    .mul(toBN(settings.vaultCollateralBuyForFlareFactorBIPS))
                    .divn(MAX_BIPS)
            );
            // TODO what to do if owner does not have enough nat
            await this.context.assetManager.unstickMinting(web3DeepNormalize(proof), toBN(minting.requestId), {
                from: this.agent.ownerAddress,
                value: burnNats,
            });
            minting.state = AgentMintingState.DONE;
            this.notifier.sendMintingCornerCase(minting.requestId.toString(), true, false);
            logger.info(`Agent ${this.agent.vaultAddress} unstuck minting ${minting.requestId}.`);
        } else {
            // proof did not expire
            const blockHeight = await this.context.blockchainIndexer.getBlockHeight();
            const latestBlock = await this.context.blockchainIndexer.getBlockAt(blockHeight);
            // wait times expires on underlying + finalizationBlock
            if (latestBlock && Number(minting.lastUnderlyingBlock) + 1 + this.context.blockchainIndexer.finalizationBlocks < latestBlock.number) {
                // time for payment expired on underlying
                logger.info(`Agent ${this.agent.vaultAddress} waited that time for underlying payment expired for minting ${minting.requestId}.`);
                const txs = await this.agent.context.blockchainIndexer.getTransactionsByReference(minting.paymentReference);
                /* istanbul ignore else */
                if (txs.length === 1) {
                    // corner case: minter pays and doesn't execute minting
                    // check minter paid -> request payment proof -> execute minting
                    const txHash = txs[0].hash;
                    // TODO is it ok to check first address in UTXO chains?
                    const sourceAddress = txs[0].inputs[0][0];
                    logger.info(`Agent ${this.agent.vaultAddress} found payment transaction ${txHash} for minting ${minting.requestId}.`);
                    await this.requestPaymentProofForMinting(minting, txHash, sourceAddress);
                } else if (txs.length === 0) {
                    // minter did not pay -> request non payment proof -> unstick minting
                    logger.info(`Agent ${this.agent.vaultAddress} did NOT found payment transaction for minting ${minting.requestId}.`);
                    await this.requestNonPaymentProofForMinting(minting);
                }
            }
        }
    }

    /**
     * Sends request for minting payment proof, sets state for minting in persistent state to REQUEST_PAYMENT_PROOF and sends notification to owner,
     * @param minting AgentMinting entity
     * @param txHash transaction hash for minting payment
     * @param sourceAddress minter's underlying address
     */
    async requestPaymentProofForMinting(minting: AgentMinting, txHash: string, sourceAddress: string): Promise<void> {
        logger.info(
            `Agent ${this.agent.vaultAddress} is sending request for payment proof for transaction ${txHash} and minting ${minting.requestId.toString()}.`
        );
        const request = await this.context.attestationProvider.requestPaymentProof(txHash, sourceAddress, this.agent.underlyingAddress);
        if (request) {
            minting.state = AgentMintingState.REQUEST_PAYMENT_PROOF;
            minting.proofRequestRound = request.round;
            minting.proofRequestData = request.data;
            this.notifier.sendMintingCornerCase(minting.requestId.toString(), false, true);
            logger.info(
                `Agent ${this.agent.vaultAddress} requested payment proof for transaction ${txHash} and minting ${minting.requestId}; source underlying address ${sourceAddress}, proofRequestRound ${request.round}, proofRequestData ${request.data}`
            );
        } else {
            // else cannot prove request yet
            logger.info(
                `Agent ${this.agent.vaultAddress} cannot yet request payment proof for transaction ${txHash} and minting ${minting.requestId.toString()}.`
            );
        }
    }

    /**
     * Sends request for minting non payment proof, sets state for minting in persistent state to REQUEST_NON_PAYMENT_PROOF and sends notification to owner,
     * @param minting AgentMinting entity
     */
    async requestNonPaymentProofForMinting(minting: AgentMinting): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is sending request for non payment proof for minting ${minting.requestId.toString()}.`);
        const request = await this.context.attestationProvider.requestReferencedPaymentNonexistenceProof(
            minting.agentUnderlyingAddress,
            minting.paymentReference,
            toBN(minting.valueUBA).add(toBN(minting.feeUBA)),
            Number(minting.firstUnderlyingBlock),
            Number(minting.lastUnderlyingBlock),
            Number(minting.lastUnderlyingTimestamp)
        );
        if (request) {
            minting.state = AgentMintingState.REQUEST_NON_PAYMENT_PROOF;
            minting.proofRequestRound = request.round;
            minting.proofRequestData = request.data;
            this.notifier.sendMintingCornerCase(minting.requestId.toString(), false, false);
            logger.info(
                `Agent ${this.agent.vaultAddress} requested non payment proof for minting ${minting.requestId}; reference ${minting.paymentReference}, target underlying address ${minting.agentUnderlyingAddress}, proofRequestRound ${request.round}, proofRequestData ${request.data}`
            );
        } else {
            // else cannot prove request yet
            logger.info(`Agent ${this.agent.vaultAddress} cannot yet prove non payment proof for minting ${minting.requestId.toString()}.`);
        }
    }

    /**
     * When minting is in state REQUEST_NON_PAYMENT_PROOF, it obtains non payment proof, calls mintingPaymentDefault and sets minting in persistent state to DONE.
     * If proof cannot be obtained, it sends notification to owner.
     * @param minting AgentMinting entity
     */
    async checkNonPayment(minting: AgentMinting): Promise<void> {
        logger.info(
            `Agent ${this.agent.vaultAddress} is trying to obtain non payment proof for minting ${minting.requestId} in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`
        );
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const proof = await this.context.attestationProvider.obtainReferencedPaymentNonexistenceProof(minting.proofRequestRound!, minting.proofRequestData!);
        if (proof === AttestationNotProved.NOT_FINALIZED) {
            logger.info(
                `Agent ${this.agent.vaultAddress}: proof not yet finalized for minting ${minting.requestId} in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`
            );
            return;
        }
        if (attestationProved(proof)) {
            logger.info(
                `Agent ${this.agent.vaultAddress} obtained non payment proof for minting ${minting.requestId} in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`
            );
            const nonPaymentProof = proof;
            await this.context.assetManager.mintingPaymentDefault(web3DeepNormalize(nonPaymentProof), minting.requestId, { from: this.agent.ownerAddress });
            minting.state = AgentMintingState.DONE;
            this.mintingExecuted(minting, true);
            logger.info(
                `Agent ${this.agent.vaultAddress} executed minting payment default for minting ${minting.requestId} with proof ${JSON.stringify(
                    web3DeepNormalize(nonPaymentProof)
                )}.`
            );
        } else {
            logger.info(
                `Agent ${this.agent.vaultAddress} cannot obtain non payment proof for minting ${minting.requestId} in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`
            );
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            this.notifier.sendNoProofObtained(minting.agentAddress, minting.requestId.toString(), minting.proofRequestRound!, minting.proofRequestData!);
        }
    }

    /**
     * When minting is in state REQUEST_PAYMENT_PROOF, it obtains payment proof, calls executeMinting and sets minting in persistent state to DONE.
     * If proof cannot be obtained, it sends notification to owner.
     * @param minting AgentMinting entity
     */
    async checkPaymentAndExecuteMinting(minting: AgentMinting): Promise<void> {
        logger.info(
            `Agent ${this.agent.vaultAddress} is trying to obtain payment proof for minting ${minting.requestId} in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`
        );
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const proof = await this.context.attestationProvider.obtainPaymentProof(minting.proofRequestRound!, minting.proofRequestData!);
        if (proof === AttestationNotProved.NOT_FINALIZED) {
            logger.info(
                `Agent ${this.agent.vaultAddress}: proof not yet finalized for minting ${minting.requestId} in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`
            );
            return;
        }
        if (attestationProved(proof)) {
            logger.info(
                `Agent ${this.agent.vaultAddress} obtained payment proof for minting ${minting.requestId} in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`
            );
            const paymentProof = proof;
            await this.context.assetManager.executeMinting(web3DeepNormalize(paymentProof), minting.requestId, { from: this.agent.ownerAddress });
            minting.state = AgentMintingState.DONE;
            logger.info(
                `Agent ${this.agent.vaultAddress} executed minting ${minting.requestId} with proof ${JSON.stringify(web3DeepNormalize(paymentProof))}.`
            );
        } else {
            logger.info(
                `Agent ${this.agent.vaultAddress} cannot obtain payment proof for minting ${minting.requestId} with in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`
            );
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            this.notifier.sendNoProofObtained(minting.agentAddress, minting.requestId.toString(), minting.proofRequestRound!, minting.proofRequestData!);
        }
    }

    /**
     * Stores received redemption request as redemption in persistent state.
     * @param em entity manager
     * @param request event's RedemptionRequested arguments
     */
    redemptionStarted(em: EM, request: EventArgs<RedemptionRequested>): void {
        em.create(
            AgentRedemption,
            {
                state: AgentRedemptionState.STARTED,
                agentAddress: this.agent.vaultAddress,
                requestId: toBN(request.requestId),
                paymentAddress: request.paymentAddress,
                valueUBA: toBN(request.valueUBA),
                feeUBA: toBN(request.feeUBA),
                paymentReference: request.paymentReference,
                lastUnderlyingBlock: toBN(request.lastUnderlyingBlock),
                lastUnderlyingTimestamp: toBN(request.lastUnderlyingTimestamp),
            } as RequiredEntityData<AgentRedemption>,
            { persist: true }
        );
        this.notifier.sendRedemptionStarted(this.agent.vaultAddress, request.requestId.toString());
        logger.info(`Agent ${this.agent.vaultAddress} started redemption ${request.requestId.toString()}.`);
    }

    /**
     * Marks stored redemption in persistent state as DONE, then it checks AgentBot's and owner's underlying balance.
     * @param em entity manager
     * @param requestId redemption request id
     * @param agentVault agent's vault address
     */
    async redemptionFinished(em: EM, requestId: BN, agentVault: string): Promise<void> {
        const redemption = await this.findRedemption(em, requestId);
        redemption.state = AgentRedemptionState.DONE;
        logger.info(`Agent ${this.agent.vaultAddress} closed redemption ${requestId.toString()}.`);
        await this.checkUnderlyingBalance(agentVault);
    }

    /**
     * Returns redemption by required id from persistent state.
     * @param em entity manager
     * @param requestId redemption request id
     * @param instance of AgentRedemption
     */
    async findRedemption(em: EM, requestId: BN): Promise<AgentRedemption> {
        const agentAddress = this.agent.vaultAddress;
        return await em.findOneOrFail(AgentRedemption, { agentAddress, requestId } as FilterQuery<AgentRedemption>);
    }

    /**
     * @param rootEm entity manager
     */
    async handleOpenRedemptions(rootEm: EM): Promise<void> {
        const openRedemptions = await this.openRedemptions(rootEm, true);
        logger.info(`Agent ${this.agent.vaultAddress} started handling open redemptions #${openRedemptions.length}.`);
        for (const rd of openRedemptions) {
            await this.nextRedemptionStep(rootEm, rd.id);
        }
        logger.info(`Agent ${this.agent.vaultAddress} finished handling open redemptions.`);
    }

    /**
     * @param rootEm entity manager
     */
    async handleOpenRedemptionsForCornerCase(rootEm: EM): Promise<void> {
        const openRedemptions = await this.openRedemptions(rootEm, false);
        logger.info(`Agent ${this.agent.vaultAddress} started handling open redemptions #${openRedemptions.length} for CORNER CASE.`);
        for (const rd of openRedemptions) {
            const proof = await this.checkProofExpiredInIndexer(toBN(rd.lastUnderlyingBlock), toBN(rd.lastUnderlyingTimestamp));
            if (proof) {
                logger.info(
                    `Agent ${this.agent.vaultAddress} found corner case for redemption ${rd.requestId} and is calling 'finishRedemptionWithoutPayment'.`
                );
                // corner case - agent did not pay
                await this.context.assetManager.finishRedemptionWithoutPayment(web3DeepNormalize(proof), rd.requestId, { from: this.agent.ownerAddress });
                rd.state = AgentRedemptionState.DONE;
                this.notifier.sendRedemptionCornerCase(rd.requestId.toString(), rd.agentAddress);
                await rootEm.persistAndFlush(rd);
                logger.info(`Agent ${this.agent.vaultAddress} closed redemption ${rd.requestId}.`);
            }
        }
        logger.info(`Agent ${this.agent.vaultAddress} finished handling open redemptions for CORNER CASE.`);
    }

    /**
     * Returns minting with state other than DONE.
     * @param em entity manager
     * @param onlyIds if true, only AgentRedemption's entity ids are return
     * * @return list of AgentRedemption's instances
     */
    async openRedemptions(em: EM, onlyIds: boolean): Promise<AgentRedemption[]> {
        let query = em.createQueryBuilder(AgentRedemption);
        if (onlyIds) query = query.select("id");
        return await query
            .where({ agentAddress: this.agent.vaultAddress })
            .andWhere({ $not: { state: AgentRedemptionState.DONE } })
            .getResultList();
    }

    /**
     * Handles redemptions stored in persistent state according to their state.
     * @param rootEm entity manager
     * @param id AgentRedemption's entity id
     */
    async nextRedemptionStep(rootEm: EM, id: number): Promise<void> {
        await rootEm
            .transactional(async (em) => {
                const redemption = await em.getRepository(AgentRedemption).findOneOrFail({ id: Number(id) } as FilterQuery<AgentRedemption>);
                logger.info(`Agent ${this.agent.vaultAddress} is handling open redemption ${redemption.requestId} in state ${redemption.state}.`);
                switch (redemption.state) {
                    case AgentRedemptionState.STARTED:
                        await this.payForRedemption(redemption);
                        break;
                    case AgentRedemptionState.PAID:
                        await this.checkPaymentProofAvailable(redemption);
                        break;
                    case AgentRedemptionState.REQUESTED_PROOF:
                        await this.checkConfirmPayment(redemption);
                        break;
                    default:
                        console.error(`Redemption state: ${redemption.state} not supported`);
                        logger.error(
                            `Agent ${this.agent.vaultAddress} run into redemption state ${
                                redemption.state
                            } not supported for redemption ${redemption.requestId.toString()}.`
                        );
                }
            })
            .catch((error) => {
                console.error(`Error handling next redemption step for redemption ${id} agent ${this.agent.vaultAddress}: ${error}`);
                logger.error(`Agent ${this.agent.vaultAddress} run into error while handling handling next redemption step for redemption ${id}: ${error}`);
            });
    }

    /**
     * When redemption is in state STARTED, it checks if payment can be done in time.
     * Then it performs payment and sets the state of redemption in persistent state as PAID.
     * @param redemption AgentRedemption entity
     */
    async payForRedemption(redemption: AgentRedemption): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is trying to pay for redemption ${redemption.requestId.toString()}.`);
        const blockHeight = await this.context.blockchainIndexer.getBlockHeight();
        const lastBlock = await this.context.blockchainIndexer.getBlockAt(blockHeight);
        /* istanbul ignore else */
        if (lastBlock && this.stillTimeToPayForRedemption(lastBlock, redemption)) {
            // pay
            const paymentAmount = toBN(redemption.valueUBA).sub(toBN(redemption.feeUBA));
            // !!! TODO: what if there are too little funds on underlying address to pay for fee?
            const txHash = await this.agent.performPayment(redemption.paymentAddress, paymentAmount, redemption.paymentReference);
            redemption.txHash = txHash;
            redemption.state = AgentRedemptionState.PAID;
            this.notifier.sendRedemptionPaid(this.agent.vaultAddress, redemption.requestId.toString());
            logger.info(
                `Agent ${this.agent.vaultAddress} paid for redemption ${redemption.requestId} with txHash ${txHash}; target underlying address ${
                    redemption.paymentAddress
                }, payment reference ${redemption.paymentReference}, amount ${paymentAmount.toString()}.`
            );
        } else if (lastBlock) {
            logger.info(
                `Agent ${this.agent.vaultAddress} DID NOT pay for redemption ${
                    redemption.requestId
                }. Time expired on underlying chain. Last block for payment was ${redemption.lastUnderlyingBlock.toString()} with timestamp ${redemption.lastUnderlyingTimestamp.toString()}. Current block is ${
                    lastBlock.number
                } with timestamp ${lastBlock.timestamp}.`
            );
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} could not retrieve last block in payForRedemption for ${redemption.requestId}.`);
        }
    }

    /**
     * Checks if redemption payment can be made in time (as specified in redemption event).
     * @param lastBlock
     * @param redemption
     * @returns
     */
    stillTimeToPayForRedemption(lastBlock: IBlock, redemption: AgentRedemption): boolean {
        const lastAcceptedBlockNumber = lastBlock.number + this.context.blockchainIndexer.finalizationBlocks + 1;
        const lastAcceptedTimestamp =
            lastBlock.timestamp +
            this.context.blockchainIndexer.finalizationBlocks * this.context.blockchainIndexer.secondsPerBlock +
            this.context.blockchainIndexer.secondsPerBlock;
        if (
            toBN(lastAcceptedBlockNumber).lt(toBN(redemption.lastUnderlyingBlock)) ||
            toBN(lastAcceptedTimestamp).lt(toBN(redemption.lastUnderlyingTimestamp))
        ) {
            return true;
        }
        return false;
    }

    /**
     * When redemption is in state PAID it requests payment proof - see requestPaymentProof().
     * @param redemption AgentRedemption entity
     */
    async checkPaymentProofAvailable(redemption: AgentRedemption): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is checking if payment proof for redemption ${redemption.requestId} is available.`);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const txBlock = await this.context.blockchainIndexer.getTransactionBlock(redemption.txHash!);
        const blockHeight = await this.context.blockchainIndexer.getBlockHeight();
        if (txBlock != null && blockHeight - txBlock.number >= this.context.blockchainIndexer.finalizationBlocks) {
            await this.requestPaymentProof(redemption);
            this.notifier.sendRedemptionRequestPaymentProof(this.agent.vaultAddress, redemption.requestId.toString());
        }
    }

    /**
     * Sends request for redemption payment proof, sets state for redemption in persistent state to REQUESTED_PROOF.
     * @param redemption AgentRedemption entity
     */
    async requestPaymentProof(redemption: AgentRedemption): Promise<void> {
        logger.info(
            `Agent ${this.agent.vaultAddress} is sending request for payment proof transaction ${
                redemption.txHash
            } and redemption ${redemption.requestId.toString()}.`
        );
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const request = await this.context.attestationProvider.requestPaymentProof(redemption.txHash!, this.agent.underlyingAddress, redemption.paymentAddress);
        if (request) {
            redemption.state = AgentRedemptionState.REQUESTED_PROOF;
            redemption.proofRequestRound = request.round;
            redemption.proofRequestData = request.data;
            logger.info(
                `Agent ${this.agent.vaultAddress} requested payment proof for transaction ${redemption.txHash} and redemption ${redemption.requestId}; target underlying address ${redemption.paymentAddress}, proofRequestRound ${request.round}, proofRequestData ${request.data}`
            );
        } else {
            // else cannot prove request yet
            logger.info(
                `Agent ${this.agent.vaultAddress} cannot yet request payment proof for transaction ${
                    redemption.txHash
                } and redemption ${redemption.requestId.toString()}.`
            );
        }
    }

    /**
     * When redemption is in state REQUESTED_PROOF, it obtains payment proof, calls confirmRedemptionPayment and sets the state of redemption in persistent state as DONE.
     * If proof expired (corner case), it calls finishRedemptionWithoutPayment, sets the state of redemption in persistent state as DONE and send notification to owner.
     * If proof cannot be obtained, it sends notification to owner.
     * @param redemption AgentRedemption entity
     */
    async checkConfirmPayment(redemption: AgentRedemption): Promise<void> {
        logger.info(
            `Agent ${this.agent.vaultAddress} is trying to obtain payment proof for redemption ${redemption.requestId} in round ${redemption.proofRequestRound} and data ${redemption.proofRequestData}.`
        );
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const proof = await this.context.attestationProvider.obtainPaymentProof(redemption.proofRequestRound!, redemption.proofRequestData!);
        if (proof === AttestationNotProved.NOT_FINALIZED) {
            logger.info(
                `Agent ${this.agent.vaultAddress}: proof not yet finalized for redemption ${redemption.requestId} in round ${redemption.proofRequestRound} and data ${redemption.proofRequestData}.`
            );
            return;
        }
        if (attestationProved(proof)) {
            logger.info(
                `Agent ${this.agent.vaultAddress} obtained payment proof for redemption ${redemption.requestId} in round ${redemption.proofRequestRound} and data ${redemption.proofRequestData}.`
            );
            const paymentProof = proof;
            await this.context.assetManager.confirmRedemptionPayment(web3DeepNormalize(paymentProof), redemption.requestId, { from: this.agent.ownerAddress });
            redemption.state = AgentRedemptionState.DONE;
            logger.info(
                `Agent ${this.agent.vaultAddress} confirmed redemption payment for redemption ${redemption.requestId} with proof ${JSON.stringify(
                    web3DeepNormalize(paymentProof)
                )}.`
            );
        } else {
            logger.info(
                `Agent ${this.agent.vaultAddress} cannot obtain payment proof for redemption ${redemption.requestId} in round ${redemption.proofRequestRound} and data ${redemption.proofRequestData}.`
            );
            this.notifier.sendNoProofObtained(
                redemption.agentAddress,
                redemption.requestId.toString(),
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                redemption.proofRequestRound!,
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                redemption.proofRequestData!,
                true
            );
        }
    }

    /**
     * Checks if proof has expired in indexer.
     * @param lastUnderlyingBlock last underlying block to perform payment
     * @param lastUnderlyingTimestamp last underlying timestamp to perform payment
     * @returns proved attestation provider data
     */
    async checkProofExpiredInIndexer(lastUnderlyingBlock: BN, lastUnderlyingTimestamp: BN): Promise<ConfirmedBlockHeightExists.Proof | null> {
        logger.info(`Agent ${this.agent.vaultAddress} is trying to check if transaction (proof) can still be obtained from indexer.`);
        const proof = this.latestProof;
        if (proof) {
            const lqwBlock = toBN(proof.data.responseBody.lowestQueryWindowBlockNumber);
            const lqwBTimestamp = toBN(proof.data.responseBody.lowestQueryWindowBlockTimestamp);
            if (lqwBlock.gt(lastUnderlyingBlock) && lqwBTimestamp.gt(lastUnderlyingTimestamp)) {
                logger.info(`Agent ${this.agent.vaultAddress} confirmed that transaction (proof) CANNOT be obtained from indexer.`);
                return proof;
            }
        }
        logger.info(`Agent ${this.agent.vaultAddress} confirmed that transaction (proof) CAN be obtained from indexer.`);
        return null;
    }

    /**
     * Marks stored AgentBot in persistent state as inactive after event 'AgentDestroyed' is received.
     * @param em entity manager
     * @param vaultAddress agent's vault address
     */
    async handleAgentDestruction(em: EM, vaultAddress: string): Promise<void> {
        const agentBotEnt = await em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress } as FilterQuery<AgentEntity>);
        agentBotEnt.active = false;
        this.notifier.sendAgentDestroyed(vaultAddress);
        logger.info(`Agent ${this.agent.vaultAddress} was destroyed.`);
    }

    /**
     * Checks AgentBot's and owner's underlying balance after redemption is finished. If AgentBot's balance is too low, it tries to top it up from owner's account. See 'underlyingTopUp(...)'.
     * @param agentVault agent's vault address
     */
    async checkUnderlyingBalance(agentVault: string): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is checking free underlying balance.`);
        const freeUnderlyingBalance = toBN((await this.agent.getAgentInfo()).freeUnderlyingBalanceUBA);
        logger.info(`Agent's ${this.agent.vaultAddress} free underlying balance is ${freeUnderlyingBalance.toString()}.`);
        const estimatedFee = toBN(await this.context.wallet.getTransactionFee());
        logger.info(`Agent's ${this.agent.vaultAddress} calculated estimated underlying fee is ${estimatedFee.toString()}.`);
        if (freeUnderlyingBalance.lte(estimatedFee.muln(NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR))) {
            await this.underlyingTopUp(estimatedFee.muln(NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR), agentVault, freeUnderlyingBalance);
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} doesn't need underlying top up.`);
        }
    }

    /**
     * Tries to top up AgentBot's underlying account from owner's. It notifies about successful and unsuccessful try.
     * It also checks owner's underlying balance and notifies when it is too low.
     * @param amount amount to transfer from owner's underlying address to agent's underlying address
     * @param agentVault agent's vault address
     * @param freeUnderlyingBalance agent's gree underlying balance
     */
    async underlyingTopUp(amount: BN, agentVault: string, freeUnderlyingBalance: BN): Promise<void> {
        const ownerUnderlyingAddress = requireSecret("owner.underlying_address");
        try {
            logger.info(
                `Agent ${this.agent.vaultAddress} is trying to top up underlying address ${this.agent.underlyingAddress} from owner's underlying address ${ownerUnderlyingAddress}.`
            );
            const txHash = await this.agent.performTopupPayment(amount, ownerUnderlyingAddress);
            await this.agent.confirmTopupPayment(txHash);
            this.notifier.sendLowUnderlyingAgentBalance(agentVault, amount.toString());
            logger.info(
                `Agent ${this.agent.vaultAddress} topped up underlying address ${
                    this.agent.underlyingAddress
                } with amount ${amount.toString()} from owner's underlying address ${ownerUnderlyingAddress} with txHash ${txHash}.`
            );
        } catch (error) {
            this.notifier.sendLowUnderlyingAgentBalanceFailed(agentVault, freeUnderlyingBalance.toString());
            logger.error(
                `Agent ${this.agent.vaultAddress} has low free underlying balance ${freeUnderlyingBalance.toString()} on underlying address ${
                    this.agent.underlyingAddress
                } and could not be topped up from owner's underlying address ${ownerUnderlyingAddress}.`
            );
        }
        const ownerUnderlyingBalance = await this.context.wallet.getBalance(ownerUnderlyingAddress);
        const estimatedFee = toBN(await this.context.wallet.getTransactionFee());
        const expectedBalance = toBN(estimatedFee.muln(NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR));
        if (ownerUnderlyingBalance.lte(expectedBalance)) {
            this.notifier.sendLowBalanceOnUnderlyingOwnersAddress(ownerUnderlyingAddress, ownerUnderlyingBalance.toString());
            logger.info(
                `Agent's ${this.agent.vaultAddress} owner ${
                    this.agent.ownerAddress
                } has low balance ${ownerUnderlyingBalance.toString()} on underlying address ${ownerUnderlyingAddress}. Expected to have at least ${expectedBalance}.`
            );
        } else {
            logger.info(
                `Agent's ${this.agent.vaultAddress} owner ${
                    this.agent.ownerAddress
                } has ${ownerUnderlyingBalance.toString()} on underlying address ${ownerUnderlyingAddress}.`
            );
        }
    }

    /**
     * Checks both AgentBot's collateral ratios. In case of either being unhealthy, it tries to top up from owner's account in order to get out of Collateral Ratio Band or Liquidation due to price changes.
     * It sends notification about successful and unsuccessful top up.
     * At the end it also checks owner's balance and notifies when too low.
     */
    async checkAgentForCollateralRatiosAndTopUp(): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is checking collateral ratios.`);
        const agentInfo = await this.agent.getAgentInfo();
        const vaultCollateralPrice = await this.agent.getVaultCollateralPrice();
        const poolCollateralPrice = await this.agent.getPoolCollateralPrice();

        const requiredCrVaultCollateralBIPS = toBN(vaultCollateralPrice.collateral.ccbMinCollateralRatioBIPS).muln(CCB_LIQUIDATION_PREVENTION_FACTOR);
        const requiredCrPoolBIPS = toBN(poolCollateralPrice.collateral.ccbMinCollateralRatioBIPS).muln(CCB_LIQUIDATION_PREVENTION_FACTOR);
        const requiredTopUpVaultCollateral = await this.requiredTopUp(requiredCrVaultCollateralBIPS, agentInfo, vaultCollateralPrice);
        const requiredTopUpPool = await this.requiredTopUp(requiredCrPoolBIPS, agentInfo, poolCollateralPrice);
        if (requiredTopUpVaultCollateral.lte(BN_ZERO) && requiredTopUpPool.lte(BN_ZERO)) {
            // no need for top up
            logger.info(`Agent ${this.agent.vaultAddress} does NOT need to top up any collateral.`);
        }
        if (requiredTopUpVaultCollateral.gt(BN_ZERO)) {
            try {
                logger.info(
                    `Agent ${this.agent.vaultAddress} is trying to top up vault collateral ${requiredTopUpVaultCollateral.toString()} from owner ${
                        this.agent.ownerAddress
                    }.`
                );
                await this.agent.depositVaultCollateral(requiredTopUpVaultCollateral);
                this.notifier.sendCollateralTopUpAlert(this.agent.vaultAddress, requiredTopUpVaultCollateral.toString());
                logger.info(
                    `Agent ${this.agent.vaultAddress} topped up vault collateral ${requiredTopUpVaultCollateral.toString()} from owner ${
                        this.agent.ownerAddress
                    }.`
                );
            } catch (err) {
                this.notifier.sendCollateralTopUpFailedAlert(this.agent.vaultAddress, requiredTopUpVaultCollateral.toString());
                logger.error(
                    `Agent ${this.agent.vaultAddress} could not be topped up with vault collateral ${requiredTopUpVaultCollateral.toString()} from owner ${
                        this.agent.ownerAddress
                    }. `
                );
            }
        }
        if (requiredTopUpPool.gt(BN_ZERO)) {
            try {
                logger.info(
                    `Agent ${this.agent.vaultAddress} is trying to buy collateral pool tokens ${requiredTopUpPool.toString()} from owner ${
                        this.agent.ownerAddress
                    }.`
                );
                await this.agent.buyCollateralPoolTokens(requiredTopUpPool);
                this.notifier.sendCollateralTopUpAlert(this.agent.vaultAddress, requiredTopUpPool.toString(), true);
                logger.info(
                    `Agent ${this.agent.vaultAddress} bought collateral pool tokens ${requiredTopUpPool.toString()} from owner ${this.agent.ownerAddress}.`
                );
            } catch (err) {
                this.notifier.sendCollateralTopUpFailedAlert(this.agent.vaultAddress, requiredTopUpPool.toString(), true);
                logger.error(
                    `Agent ${this.agent.vaultAddress} could not buy collateral pool tokens ${requiredTopUpPool.toString()} from owner ${
                        this.agent.ownerAddress
                    }.`
                );
            }
        }
        const vaultCollateralToken = await IERC20.at(vaultCollateralPrice.collateral.token);
        const ownerBalanceVaultCollateral = await vaultCollateralToken.balanceOf(this.agent.ownerAddress);
        const stableCoinLowBalance = toBNExp(STABLE_COIN_LOW_BALANCE, Number(vaultCollateralPrice.collateral.decimals));
        if (ownerBalanceVaultCollateral.lte(stableCoinLowBalance)) {
            this.notifier.sendLowBalanceOnOwnersAddress(
                this.agent.ownerAddress,
                ownerBalanceVaultCollateral.toString(),
                vaultCollateralPrice.collateral.tokenFtsoSymbol
            );
            logger.info(
                `Agent's ${this.agent.vaultAddress} owner ${
                    this.agent.ownerAddress
                } has low vault collateral balance ${ownerBalanceVaultCollateral.toString()} ${vaultCollateralPrice.collateral.tokenFtsoSymbol}.`
            );
        }
        const ownerBalance = toBN(await web3.eth.getBalance(this.agent.ownerAddress));
        const nativeLowBlance = toBNExp(NATIVE_LOW_BALANCE, 18);
        if (ownerBalance.lte(nativeLowBlance)) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            this.notifier.sendLowBalanceOnOwnersAddress(this.agent.ownerAddress, ownerBalance.toString(), poolCollateralPrice.collateral.tokenFtsoSymbol);
            logger.info(
                `Agent's ${this.agent.vaultAddress} owner ${this.agent.ownerAddress} has low native balance ${ownerBalance.toString()} ${
                    poolCollateralPrice.collateral.tokenFtsoSymbol
                }.`
            );
        }
    }

    /**
     * Returns the value that is required to be topped up in order to reach healthy collateral ratio.
     * If value is less than zero, top up is not needed.
     * @param requiredCrBIPS required collateral ratio for healthy state (in BIPS)
     * @param agentInfo AgentInfo object
     * @param cp CollateralPrice object
     * @return required amount for top up to reach healthy collateral ratio
     */
    private async requiredTopUp(requiredCrBIPS: BN, agentInfo: AgentInfo, cp: CollateralPrice): Promise<BN> {
        const redeemingUBA = Number(cp.collateral.collateralClass) == CollateralClass.VAULT ? agentInfo.redeemingUBA : agentInfo.poolRedeemingUBA;
        const balance = toBN(
            Number(cp.collateral.collateralClass) == CollateralClass.VAULT ? agentInfo.totalVaultCollateralWei : agentInfo.totalPoolCollateralNATWei
        );
        const totalUBA = toBN(agentInfo.mintedUBA).add(toBN(agentInfo.reservedUBA)).add(toBN(redeemingUBA));
        const backingVaultCollateralWei = cp.convertUBAToTokenWei(totalUBA);
        const requiredCollateral = backingVaultCollateralWei.mul(requiredCrBIPS).divn(MAX_BIPS);
        return requiredCollateral.sub(balance);
    }
}
