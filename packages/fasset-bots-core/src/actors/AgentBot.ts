import { AddressValidity, ConfirmedBlockHeightExists } from "@flarenetwork/state-connector-protocol";
import { FilterQuery } from "@mikro-orm/core";
import BN from "bn.js";
import { AgentPing } from "../../typechain-truffle/IIAssetManager";
import { AgentBotSettings, Secrets } from "../config";
import { AgentVaultInitSettings } from "../config/AgentVaultInitSettings";
import { EM } from "../config/orm";
import { AgentEntity } from "../entities/agent";
import { AgentRedemptionState } from "../entities/common";
import { IAssetAgentContext } from "../fasset-bots/IAssetBotContext";
import { Agent, OwnerAddressPair } from "../fasset/Agent";
import { PaymentReference } from "../fasset/PaymentReference";
import { attestationProved } from "../underlying-chain/AttestationHelper";
import { ChainId } from "../underlying-chain/ChainId";
import { TX_SUCCESS } from "../underlying-chain/interfaces/IBlockChain";
import { CommandLineError, TokenBalances, checkUnderlyingFunds, programVersion, SimpleThrottler } from "../utils";
import { EventArgs, EvmEvent } from "../utils/events/common";
import { eventIs } from "../utils/events/truffle";
import { FairLock } from "../utils/FairLock";
import { formatArgs, formatTimestamp, squashSpace } from "../utils/formatting";
import { BN_ZERO, BNish, DAYS, MINUTES, ZERO_ADDRESS, assertNotNull, getOrCreate, sleepUntil, toBN } from "../utils/helpers";
import { logger, loggerAsyncStorage } from "../utils/logger";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";
import { NotifierTransport } from "../utils/notifier/BaseNotifier";
import { artifacts, web3 } from "../utils/web3";
import { latestBlockTimestampBN } from "../utils/web3helpers";
import { web3DeepNormalize } from "../utils/web3normalize";
import { AgentBotClaims } from "./AgentBotClaims";
import { AgentBotClosing } from "./AgentBotClosing";
import { AgentBotCollateralManagement } from "./AgentBotCollateralManagement";
import { AgentBotCollateralWithdrawal } from "./AgentBotCollateralWithdrawal";
import { AgentBotEventReader } from "./AgentBotEventReader";
import { AgentBotMinting } from "./AgentBotMinting";
import { AgentBotRedemption } from "./AgentBotRedemption";
import { AgentBotUnderlyingManagement } from "./AgentBotUnderlyingManagement";
import { AgentBotUnderlyingWithdrawal } from "./AgentBotUnderlyingWithdrawal";
import { AgentBotUpdateSettings } from "./AgentBotUpdateSettings";
import { AgentTokenBalances } from "./AgentTokenBalances";
import { AgentBotHandshake } from "./AgentBotHandshake";
import { HandshakeAddressVerifier } from "./plugins/HandshakeAddressVerifier";

const PING_RESPONSE_MIN_INTERVAL_PER_SENDER_MS = 2 * MINUTES * 1000;

const AgentVault = artifacts.require("AgentVault");
const CollateralPool = artifacts.require("CollateralPool");
const CollateralPoolToken = artifacts.require("CollateralPoolToken");

export interface IRunner {
    stopRequested: boolean;
    restartRequested: boolean;
}

export interface ITimeKeeper {
    latestProof?: ConfirmedBlockHeightExists.Proof;
}

export const PERFORM_DAILY_TASKS_EVERY = 1 * DAYS;

/**
 * Data that has to persist throughout a program, but not forever.
 * It cannot be stored directly in AgentBot class, because that is re-created on every loop of AgentBotRunner.
 */
export class AgentBotTransientStorage {
    static deepCopyWithObjectCreate = true;

    // used by AgentBotEventReader.checkForPriceChangeEvents to track the last block for which PriceFinalized event was called
    lastPriceReaderEventBlock = -1;

    // used by getUnderlyingBlockHeightProof to detect when the wait is too long and agent has to be notified
    waitingForLatestBlockProofSince = BN_ZERO;

    // the block when outdated agent was last reported
    lastOutdatedEventReported = 0;

    // certain operation (e.g. initial underlying topup) are only run once at the start of session for each agent bot
    botInitalizationCompleted = false;
}

export class AgentBotLocks {
    static deepCopyWithObjectCreate = true;

    nativeChainLockMap = new Map<string, FairLock>();
    underlyingLockMap = new Map<string, FairLock>();
    databaseLock = new FairLock();

    nativeChainLock(address: string) {
        return getOrCreate(this.nativeChainLockMap, address, () => new FairLock());
    }

    underlyingLock(address: string) {
        return getOrCreate(this.underlyingLockMap, address, () => new FairLock());
    }
}

export class AgentBot {
    static deepCopyWithObjectCreate = true;

    constructor(
        public agent: Agent,
        public agentBotSettings: AgentBotSettings,
        public notifier: AgentNotifier,
        public owner: OwnerAddressPair,
        public ownerUnderlyingAddress: string,
        public handshakeAddressVerifier: HandshakeAddressVerifier | null
    ) {}

    context = this.agent.context;
    tokens = new AgentTokenBalances(this.context, this.agent.vaultAddress);
    eventReader = new AgentBotEventReader(this, this.context, this.notifier, this.agent.vaultAddress);
    handshake = new AgentBotHandshake(this, this.agent, this.notifier, this.handshakeAddressVerifier);
    minting = new AgentBotMinting(this, this.agent, this.notifier);
    redemption = new AgentBotRedemption(this, this.agent, this.notifier);
    underlyingManagement = new AgentBotUnderlyingManagement(this, this.agent, this.agentBotSettings, this.notifier, this.ownerUnderlyingAddress, this.tokens);
    underlyingWithdrawal = new AgentBotUnderlyingWithdrawal(this, this.agent, this.notifier);
    updateSetting = new AgentBotUpdateSettings(this, this.agent, this.notifier);
    collateralManagement = new AgentBotCollateralManagement(this, this.agent, this.agentBotSettings, this.notifier, this.tokens);
    collateralWithdrawal = new AgentBotCollateralWithdrawal(this);
    claims = new AgentBotClaims(this);
    closing = new AgentBotClosing(this);

    // only set when created by an AgentBotRunner
    runner?: IRunner;
    timekeeper?: ITimeKeeper;
    transientStorage: AgentBotTransientStorage = new AgentBotTransientStorage();    // changed when running in AgentBotRunner
    locks = new AgentBotLocks(); // changed when running in AgentBotRunner
    loopDelay = 0;

    // internal
    private _running: boolean = false;
    private _stopRequested: boolean = false;
    private _restartRequested: boolean = false;

    private pingResponseRateLimiter = new SimpleThrottler<string>(PING_RESPONSE_MIN_INTERVAL_PER_SENDER_MS);

    static async createUnderlyingAddress(context: IAssetAgentContext) {
        return await context.wallet.createAccount();
    }

    static async initializeUnderlyingAddress(context: IAssetAgentContext, owner: OwnerAddressPair, ownerUnderlyingAddress: string, underlyingAddress: string) {
        // on XRP chain, send 10 XRP from owners account to activate agent's account
        await this.activateUnderlyingAccount(context, owner, ownerUnderlyingAddress, underlyingAddress);
        // validate address
        const addressValidityProof = await context.attestationProvider.proveAddressValidity(underlyingAddress);
        // prove EOA if necessary
        const settings = await context.assetManager.getSettings();
        if (settings.requireEOAAddressProof) {
            await this.proveEOAaddress(context, addressValidityProof.data.responseBody.standardAddress, owner);
        }
        return addressValidityProof;
    }

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
        context: IAssetAgentContext,
        agentBotSettings: AgentBotSettings,
        owner: OwnerAddressPair,
        ownerUnderlyingAddress: string,
        addressValidityProof: AddressValidity.Proof,
        agentSettingsConfig: AgentVaultInitSettings,
        notifierTransports: NotifierTransport[],
        handshakeAddressVerifier: HandshakeAddressVerifier | null
    ): Promise<AgentBot> {
        logger.info(`Starting to create agent for owner ${owner.managementAddress} with settings ${JSON.stringify(agentSettingsConfig)}.`);
        // ensure that work address is defined
        if (owner.workAddress === ZERO_ADDRESS) {
            throw new Error(`Management address ${owner.managementAddress} has no registered work address.`);
        }
        // create agent
        const lastBlock = await web3.eth.getBlockNumber();
        const agent = await Agent.create(context, owner, addressValidityProof, agentSettingsConfig);
        // save state
        const agentEntity = new AgentEntity();
        agentEntity.chainId = context.chainInfo.chainId.sourceId;
        agentEntity.assetManager = context.assetManager.address;
        agentEntity.fassetSymbol = context.fAssetSymbol;
        agentEntity.ownerAddress = agent.owner.managementAddress;
        agentEntity.vaultAddress = agent.vaultAddress;
        agentEntity.underlyingAddress = agent.underlyingAddress;
        agentEntity.active = true;
        agentEntity.currentEventBlock = lastBlock + 1;
        agentEntity.collateralPoolAddress = agent.collateralPool.address;
        await rootEm.persistAndFlush(agentEntity);

        logger.info(squashSpace`Agent ${agent.vaultAddress} was created by owner ${agent.owner},
            underlying address ${agent.underlyingAddress} and collateral pool address ${agent.collateralPool.address}.`);

        const notifier = new AgentNotifier(agent.vaultAddress, notifierTransports);
        return new AgentBot(agent, agentBotSettings, notifier, owner, ownerUnderlyingAddress, handshakeAddressVerifier);
    }

    /**
     * This method fixes the underlying address to be used by given AgentBot owner.
     * @param context fasset agent bot context
     * @param underlyingAddress agent's underlying address
     * @param ownerAddress agent's owner native address
     */
    /* istanbul ignore next */
    static async proveEOAaddress(context: IAssetAgentContext, underlyingAddress: string, owner: OwnerAddressPair): Promise<void> {
        const reference = PaymentReference.addressOwnership(owner.managementAddress);
        // 1 = smallest possible amount (as in 1 satoshi or 1 drop)
        const smallest_amount = 1;
        await checkUnderlyingFunds(context, underlyingAddress, smallest_amount, underlyingAddress);
        const txHash = await context.wallet.addTransactionAndWaitForItsFinalization(underlyingAddress, underlyingAddress, smallest_amount, reference);
        await context.blockchainIndexer.waitForUnderlyingTransactionFinalization(txHash);
        const proof = await context.attestationProvider.provePayment(txHash, underlyingAddress, underlyingAddress);
        await context.assetManager.proveUnderlyingAddressEOA(web3DeepNormalize(proof), { from: owner.workAddress });
    }

    /**
     * Creates instance of AgentBot from persistent state.
     * @param context fasset agent bot context
     * @param agentEntity stored agent entity
     * @param notifier
     * @returns instance of AgentBot class
     */
    static async fromEntity(
        context: IAssetAgentContext,
        agentBotSettings: AgentBotSettings,
        agentEntity: AgentEntity,
        ownerUnderlyingAddress: string,
        notifierTransports: NotifierTransport[],
        handshakeAddressVerifier: HandshakeAddressVerifier | null = null
    ): Promise<AgentBot> {
        logger.info(`Starting to recreate agent ${agentEntity.vaultAddress} from DB for owner ${agentEntity.ownerAddress}.`);
        const agentVault = await AgentVault.at(agentEntity.vaultAddress);
        // get collateral pool
        const collateralPool = await CollateralPool.at(agentEntity.collateralPoolAddress);
        // get pool token
        const poolTokenAddress = await collateralPool.poolToken();
        const collateralPoolToken = await CollateralPoolToken.at(poolTokenAddress);
        // get work address
        const owner = await Agent.getOwnerAddressPair(context, agentEntity.ownerAddress);
        // ensure that work address is defined
        if (owner.workAddress === ZERO_ADDRESS) {
            throw new Error(`Management address ${owner.managementAddress} has no registered work address.`);
        }
        // agent
        const agent = new Agent(context, owner, agentVault, collateralPool, collateralPoolToken, agentEntity.underlyingAddress);
        logger.info(squashSpace`Agent ${agent.vaultAddress} was restored from DB by owner ${agent.owner},
            underlying address ${agent.underlyingAddress} and collateral pool address ${agent.collateralPool.address}.`);
        const notifier = new AgentNotifier(agent.vaultAddress, notifierTransports);
        return new AgentBot(agent, agentBotSettings, notifier, owner, ownerUnderlyingAddress, handshakeAddressVerifier);
    }

    static underlyingAddress(secrets: Secrets, chainId: ChainId) {
        return secrets.required(`owner.${chainId.chainName}.address`);
    }

    /**
     * Activates agent's underlying account.
     * @param context fasset agent bot context
     * @param vaultUnderlyingAddress agent's underlying address
     */
    static async activateUnderlyingAccount(context: IAssetAgentContext, owner: OwnerAddressPair, ownerUnderlyingAddress: string, vaultUnderlyingAddress: string): Promise<void> {
        const starterAmount = toBN(context.chainInfo.minimumAccountBalance);
        if (starterAmount.eq(BN_ZERO)) return;
        const balanceReader = await TokenBalances.fassetUnderlyingToken(context);
        try {
            const reference = owner.managementAddress;
            await checkUnderlyingFunds(context, ownerUnderlyingAddress, starterAmount, vaultUnderlyingAddress);
            const txHash = await context.wallet.addTransactionAndWaitForItsFinalization(ownerUnderlyingAddress, vaultUnderlyingAddress, starterAmount, reference);
            const transaction = await context.blockchainIndexer.waitForUnderlyingTransactionFinalization(txHash);
            /* istanbul ignore next */
            if (!transaction || transaction?.status != TX_SUCCESS) {
                throw new Error(`Could not activate or verify new ${balanceReader.symbol} account with transaction ${txHash}`);
            }
            logger.info(`Owner ${owner} activated underlying address ${vaultUnderlyingAddress} with transaction ${txHash}.`);
        } catch (error) {
            logger.error(`Owner ${owner} couldn't activate underlying address ${vaultUnderlyingAddress}:`, error);
            throw new CommandLineError(squashSpace`Could not activate or verify new agent vault's ${balanceReader.symbol}  account.
                Note that the owner's ${balanceReader.symbol}  account ${ownerUnderlyingAddress} requires at least ${2 * Number(starterAmount) * 1e-6 + 1} ${balanceReader.symbol}  to activate the new account.`);
        }
    }

    requestStop(): void {
        this._stopRequested = true;
    }

    stopRequested(): boolean {
        return (this.runner?.stopRequested ?? false) || this._stopRequested;
    }

    restartRequested(): boolean {
        return (this.runner?.restartRequested ?? false) || this._restartRequested;
    }

    stopOrRestartRequested(): boolean {
        return this.stopRequested() || this.restartRequested();
    }

    running(): boolean {
        return this._running;
    }

    requestSubmitterAddress() {
        return this.context.attestationProvider.flareDataConnector.account ?? this.owner.workAddress;
    }

    /**
     * This method will be run once for each bot when run-agent is started and
     * when a new agent vault is created and detected by the run-agent.
     */
    async runBotInitialOperations(rootEm: EM) {
        if (this.transientStorage.botInitalizationCompleted) return;
        await this.underlyingManagement.checkUnderlyingBalanceAndTopup(rootEm);
        this.transientStorage.botInitalizationCompleted = true;
    }

    /**
     * Run all bot operations in parallel.
     * @param rootEm the database entity manager
     */
    async runThreads(rootEm: EM) {
        const threads: Promise<void>[] = [];
        this._running = true;
        try {
            logger.info(`Starting threads for agent ${this.agent.vaultAddress}.`);
            const botId = this.agent.vaultAddress.slice(2, 10);
            // one thread for reading events
            threads.push(this.startThread(rootEm, `events-${botId}`, true, async (threadEm) => {
                await this.handleEvents(threadEm);
            }));
            // one thread for every redemption state
            for (const redemptionState of Object.values(AgentRedemptionState)) {
                if (redemptionState === AgentRedemptionState.DONE) continue;
                threads.push(this.startThread(rootEm, `redemptions-${redemptionState}-${botId}`, true, async (threadEm) => {
                    await this.redemption.handleRedemptionsInState(threadEm, redemptionState);
                }));
            }
            threads.push(this.startThread(rootEm, `redemptions-expired-${botId}`, true, async (threadEm) => {
                await this.redemption.handleExpiredRedemptions(threadEm);
            }));
            threads.push(this.startThread(rootEm, `rejected-redemption-requests-${botId}`, true, async (threadEm) => {
                await this.redemption.handleRejectedRedemptionRequests(threadEm);
            }));
            threads.push(this.startThread(rootEm, `handshakes-${botId}`, true, async (threadEm) => {
                await this.handshake.handleOpenHandshakes(threadEm);
            }));
            threads.push(this.startThread(rootEm, `mintings-${botId}`, true, async (threadEm) => {
                await this.minting.handleOpenMintings(threadEm);
            }));
            threads.push(this.startThread(rootEm, `timelocked-proc-${botId}`, true, async (threadEm) => {
                await this.handleTimelockedProcesses(threadEm);
            }));
            threads.push(this.startThread(rootEm, `underlying-payments-${botId}`, true, async (threadEm) => {
                await this.underlyingManagement.handleOpenUnderlyingPayments(threadEm);
            }));
            threads.push(this.startThread(rootEm, `daily-tasks-${botId}`, true, async (threadEm) => {
                await this.handleDailyTasks(threadEm);
            }));
            // wait for all to finish
            await Promise.allSettled(threads);
        } finally {
            logger.info(`All threads for agent ${this.agent.vaultAddress} ended.`);
            this._running = false;
        }
    }

    /**
     * Start the read and optionally run it in a loop.
     * @param rootEm the entity manager, will be forked for thread
     * @param loop if true, the thread loops until `stopOrRestartRequested()` is true
     * @param method the thread method (if loop is true, it will be run repeatedly)
     * @returns promise that resolves when thread exits
     */
    async startThread(rootEm: EM, name: string, loop: boolean, method: (em: EM) => Promise<void>) {
        await loggerAsyncStorage.run(name, async () => {
            logger.info(`Thread started ${name}.`);
            const threadEm = rootEm.fork();
            while (!this.stopOrRestartRequested()) {
                try {
                    await method(threadEm);
                } catch (error) {
                    logger.error(`Unexpected error in agent bot thread loop:`, error);
                }
                if (!loop) break;
                // wait a bit so that idle threads do not burn too much time
                logger.info(`Finished handling, sleeping ${this.loopDelay / 1000}s`);
                await sleepUntil(this.loopDelay, () => this.stopOrRestartRequested());
            }
            logger.info(`Thread ended ${name}.`);
        })
    }

    /**
     * The unthreaded single-step method, used for tests.
     * @param rootEm entity manager
     */
    async runStep(rootEm: EM): Promise<void> {
        await this.handleEvents(rootEm);
        await this.redemption.handleOpenRedemptions(rootEm);
        await this.redemption.handleRejectedRedemptionRequests(rootEm);
        await this.handshake.handleOpenHandshakes(rootEm);
        await this.minting.handleOpenMintings(rootEm);
        await this.handleTimelockedProcesses(rootEm);
        await this.underlyingManagement.handleOpenUnderlyingPayments(rootEm);
        await this.handleDailyTasks(rootEm);
    }

    async handleEvents(rootEm: EM) {
        await this.eventReader.troubleshootEvents(rootEm);
        await this.eventReader.checkForPriceChangeEvents();
        await this.eventReader.handleNewEvents(rootEm);
    }

    async handleEvent(em: EM, event: EvmEvent): Promise<void> {

        // handle all events for RedemptionRequestRejected and RedemptionRequestTakenOver
        if (eventIs(event, this.context.assetManager, "RedemptionRequestRejected")) {
            await this.redemption.redemptionRequestRejected(em, event.args, event.blockNumber);
            return;
        } else if (eventIs(event, this.context.assetManager, "RedemptionRequestTakenOver")) {
            await this.redemption.redemptionRequestTakenOver(em, event.args);
            return;
        }
        // all other events are events for this agent (this should already be the case due to filter in readNewEvents, but just to be sure)
        const agentVault = (event.args as any).agentVault;
        if (agentVault && agentVault.toLowerCase() !== this.agent.vaultAddress.toLowerCase()) return;
        if (eventIs(event, this.context.assetManager, "HandshakeRequired")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'HandshakeRequired' with data ${formatArgs(event.args)}.`);
            await this.handshake.handshakeRequired(em, event.args);
        } else if (eventIs(event, this.context.assetManager, "CollateralReservationCancelled")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'CollateralReservationCancelled' with data ${formatArgs(event.args)}.`);
            await this.handshake.mintingCancelled(em, event.args);
        } else if (eventIs(event, this.context.assetManager, "CollateralReservationRejected")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'CollateralReservationRejected' with data ${formatArgs(event.args)}.`);
            await this.handshake.mintingRejected(em, event.args);
        } else if (eventIs(event, this.context.assetManager, "CollateralReserved")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'CollateralReserved' with data ${formatArgs(event.args)}.`);
            await this.minting.mintingStarted(em, event.args);
        } else if (eventIs(event, this.context.assetManager, "CollateralReservationDeleted")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'CollateralReservationDeleted' with data ${formatArgs(event.args)}.`);
            await this.minting.mintingDeleted(em, event.args);
        } else if (eventIs(event, this.context.assetManager, "MintingExecuted")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'MintingExecuted' with data ${formatArgs(event.args)}.`);
            await this.minting.mintingExecuted(em, event.args);
        } else if (eventIs(event, this.context.assetManager, "SelfMint")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'SelfMint' with data ${formatArgs(event.args)}.`);
            await this.minting.selfMintingExecuted(event.args);
        } else if (eventIs(event, this.context.assetManager, "RedemptionRequested")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'RedemptionRequested' with data ${formatArgs(event.args)}.`);
            await this.redemption.redemptionStarted(em, event.args);
        } else if (eventIs(event, this.context.assetManager, "RedemptionDefault")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'RedemptionDefault' with data ${formatArgs(event.args)}.`);
            await this.redemption.redemptionDefault(em, event.args);
        } else if (eventIs(event, this.context.assetManager, "RedemptionPerformed")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'RedemptionPerformed' with data ${formatArgs(event.args)}.`);
            await this.redemption.redemptionPerformed(em, event.args);
        } else if (eventIs(event, this.context.assetManager, "RedemptionPaymentFailed")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'RedemptionPaymentFailed' with data ${formatArgs(event.args)}.`);
            await this.redemption.redemptionPaymentFailed(em, event.args);
        } else if (eventIs(event, this.context.assetManager, "RedemptionPaymentBlocked")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'RedemptionPaymentBlocked' with data ${formatArgs(event.args)}.`);
            await this.redemption.redemptionPaymentBlocked(em, event.args);
        } else if (eventIs(event, this.context.assetManager, "AgentDestroyed")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'AgentDestroyed' with data ${formatArgs(event.args)}.`);
            await this.closing.handleAgentDestroyed(em);
        } else if (eventIs(event, this.context.assetManager, "AgentInCCB")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'AgentInCCB' with data ${formatArgs(event.args)}.`);
            await this.collateralManagement.checkAgentForCollateralRatiosAndTopUp();
            await this.notifier.sendCCBAlert(`${formatTimestamp(event.args.timestamp)} (${event.args.timestamp})`);
        } else if (eventIs(event, this.context.assetManager, "LiquidationStarted")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'LiquidationStarted' with data ${formatArgs(event.args)}.`);
            await this.collateralManagement.checkAgentForCollateralRatiosAndTopUp();
            await this.notifier.sendLiquidationStartAlert(`${formatTimestamp(event.args.timestamp)} (${event.args.timestamp})`);
        } else if (eventIs(event, this.context.assetManager, "LiquidationEnded")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'LiquidationEnded' with data ${formatArgs(event.args)}.`);
            await this.notifier.sendLiquidationEndedAlert();
        } else if (eventIs(event, this.context.assetManager, "LiquidationPerformed")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'LiquidationPerformed' with data ${formatArgs(event.args)}.`);
            await this.notifier.sendLiquidationWasPerformed(await this.tokens.fAsset.format(event.args.valueUBA));
        } else if (eventIs(event, this.context.assetManager, "UnderlyingBalanceTooLow")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'UnderlyingBalanceTooLow' with data ${formatArgs(event.args)}.`);
            await this.notifier.sendFullLiquidationAlert();
        } else if (eventIs(event, this.context.assetManager, "DuplicatePaymentConfirmed")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'DuplicatePaymentConfirmed' with data ${formatArgs(event.args)}.`);
            await this.notifier.sendFullLiquidationAlert(event.args.transactionHash1, event.args.transactionHash2);
        } else if (eventIs(event, this.context.assetManager, "IllegalPaymentConfirmed")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'IllegalPaymentConfirmed' with data ${formatArgs(event.args)}.`);
            await this.notifier.sendFullLiquidationAlert(event.args.transactionHash);
        } else if (eventIs(event, this.context.assetManager, "AgentPing")) {
            await this.handleAgentPing(event.args);
        }
    }

    /**
     * Once a day checks corner cases and claims.
     * @param rootEm entity manager
     */
    async handleDailyTasks(rootEm: EM): Promise<void> {
        try {
            if (this.stopOrRestartRequested()) return;
            const readAgentEnt = await this.fetchAgentEntity(rootEm)
            const timestamp = await latestBlockTimestampBN();
            if (timestamp.sub(readAgentEnt.dailyTasksTimestamp).ltn(PERFORM_DAILY_TASKS_EVERY)) return;
            const blockHeightProof = await this.getUnderlyingBlockHeightProof();
            if (blockHeightProof == null) return;
            // handle
            logger.info(`Agent ${this.agent.vaultAddress} is handling daily tasks with block heigh exists proof in round ${blockHeightProof.data.votingRound} for block ${blockHeightProof.data.requestBody.blockNumber}.`);
            await this.claims.checkForClaims();
            // remember last handling time
            await this.updateAgentEntity(rootEm, async (agentEnt) => {
                agentEnt.dailyTasksTimestamp = toBN(timestamp);
            });
            logger.info(`Agent ${this.agent.vaultAddress} finished handling daily tasks with block heigh exists proof in round ${blockHeightProof.data.votingRound} for block ${blockHeightProof.data.requestBody.blockNumber}.`);
        } catch (error) {
            console.error(`Error while handling daily tasks for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling daily tasks:`, error);
        }
    }

    /**
     * Checks and handles if there are any AgentBot actions (withdraw, exit available list, update AgentBot setting) waited to be executed due to required announcement or time lock.
     * @param rootEm entity manager
     */
    async handleTimelockedProcesses(rootEm: EM): Promise<void> {
        if (this.stopOrRestartRequested()) return;
        logger.info(`Agent ${this.agent.vaultAddress} started handling 'handleTimelockedProcesses'.`);
        await this.collateralWithdrawal.handleWaitForCollateralWithdrawal(rootEm);
        await this.collateralWithdrawal.handleWaitForPoolTokenRedemption(rootEm);
        await this.handleWaitAgentExitAvailable(rootEm);
        await this.updateSetting.handleWaitForAgentSettingUpdate(rootEm);
        await this.underlyingWithdrawal.handleUnderlyingWithdrawal(rootEm);
        await this.closing.handleAgentCloseProcess(rootEm);
        logger.info(`Agent ${this.agent.vaultAddress} finished handling 'handleTimelockedProcesses'.`);
    }

    /**
     * AgentBot exits available if already allowed
     * @param agentEnt agent entity
     */
    async handleWaitAgentExitAvailable(rootEm: EM) {
        if (this.stopOrRestartRequested()) return;
        try {
            const readAgentEnt = await this.fetchAgentEntity(rootEm);
            const latestTimestamp = await latestBlockTimestampBN();
            if (this.announcementStatus(readAgentEnt.exitAvailableAllowedAtTimestamp, latestTimestamp) !== "ALLOWED") return;
            await this.exitAvailable(rootEm);
        } catch (error) {
            console.error(`Error while handling wait for agent exit available for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling wait for agent exit available during handleTimelockedProcesses:`, error);
        }
    }

    async exitAvailable(rootEm: EM) {
        await this.locks.nativeChainLock(this.owner.workAddress).lockAndRun(async () => {
            await this.agent.exitAvailable();
        })
        await this.updateAgentEntity(rootEm, async (agentEnt) => {
            agentEnt.exitAvailableAllowedAtTimestamp = BN_ZERO;
        });
        await this.notifier.sendAgentExitedAvailable();
        logger.info(`Agent ${this.agent.vaultAddress} exited available list.`);
    }

    /**
     * Return the status of "exit available" process
     * @param agentEnt agent entity
     * @returns current status: NOT_ANNOUNCED -> WAITING -> ALLOWED -> EXITED
     */
    async getExitAvailableProcessStatus(agentEnt: AgentEntity) {
        const agentInfo = await this.agent.getAgentInfo();
        if (!agentInfo.publiclyAvailable) return "EXITED";
        return this.announcementStatus(agentEnt.exitAvailableAllowedAtTimestamp, await latestBlockTimestampBN());
    }

    /**
     * Return status of any action requiring announcement (withdrawal, exit, etc.)
     * @param actionAllowedAt the saved timestamp of when the action is allowed
     * @param currentTimestamp the current timestamp
     * @returns current status: NOT_ANNOUNCED -> WAITING -> ALLOWED
     */
    announcementStatus(actionAllowedAt: BNish, currentTimestamp: BN) {
        actionAllowedAt = toBN(actionAllowedAt);
        if (actionAllowedAt.eq(BN_ZERO)) return "NOT_ANNOUNCED";
        if (actionAllowedAt.gt(currentTimestamp)) return "WAITING";
        return "ALLOWED";
    }

    /**
     * Checks if proof has expired in indexer.
     * @param lastUnderlyingBlock last underlying block to perform payment
     * @param lastUnderlyingTimestamp last underlying timestamp to perform payment
     * @returns proved attestation provider data
     */
    async checkProofExpiredInIndexer(lastUnderlyingBlock: BN, lastUnderlyingTimestamp: BN): Promise<ConfirmedBlockHeightExists.Proof | "NOT_EXPIRED" | "WAITING_PROOF"> {
        // logger.info(`Agent ${this.agent.vaultAddress} is trying to check if transaction (proof) can still be obtained from indexer.`);
        // try to get proof whether payment/non-payment proofs have expired
        const proof = await this.getUnderlyingBlockHeightProof();
        if (proof) {
            const lqwBlock = toBN(proof.data.responseBody.lowestQueryWindowBlockNumber);
            const lqwBTimestamp = toBN(proof.data.responseBody.lowestQueryWindowBlockTimestamp);
            if (lqwBlock.gt(lastUnderlyingBlock) && lqwBTimestamp.gt(lastUnderlyingTimestamp)) {
                logger.info(`Agent ${this.agent.vaultAddress} confirmed that transaction (proof) CANNOT be obtained from indexer.`);
                return proof;
            } else {
                // logger.info(`Agent ${this.agent.vaultAddress} confirmed that transaction (proof) CAN be obtained from indexer.`);
                return "NOT_EXPIRED";
            }
        }
        return "WAITING_PROOF";
    }

    /**
     * Get the latest underlying block height exists proof from the timekeeper
     */
    async getUnderlyingBlockHeightProof() {
        assertNotNull(this.timekeeper, "Cannot obtain underlying block height - timekeeper not set.");
        // obtain the proof
        const proof = this.timekeeper.latestProof;
        if (attestationProved(proof)) {
            this.transientStorage.waitingForLatestBlockProofSince = BN_ZERO;
            return proof;
        }
        // if waiting for proof for more than expected time, notify agent and restart wait
        const timestamp = await latestBlockTimestampBN();
        const waitingSince = this.transientStorage.waitingForLatestBlockProofSince;
        if (waitingSince.gt(BN_ZERO) && timestamp.sub(waitingSince).gtn(10 * MINUTES)) {
            await this.notifier.sendDailyTaskNoProofObtained(10);
            this.transientStorage.waitingForLatestBlockProofSince = timestamp;
        }
        // start waiting for proof
        if (this.transientStorage.waitingForLatestBlockProofSince.eq(BN_ZERO)) {
            this.transientStorage.waitingForLatestBlockProofSince = timestamp;
        }
    }

    /**
     * Respond to ping, measuring agent liveness
     * @param query query number - 0 means return version
     */
    async handleAgentPing(args: EventArgs<AgentPing>) {
        try {
            // only respond to pings from trusted senders
            if (!this.agentBotSettings.trustedPingSenders.has(args.sender.toLowerCase())) return;
            // do not respond if ping is too frequent (DOS protection)
            if (!this.pingResponseRateLimiter.allow(args.sender)) return;
            // log after checking for trusted
            logger.info(`Agent ${this.agent.vaultAddress} received event 'AgentPing' with data ${formatArgs(args)}.`);
            const query = toBN(args.query);
            // upper 32 bits are query topic; the rest is topic specific, e.g. query id
            const topic = Number(query.shrn(256 - 32));
            if (topic === 0) {
                const data = JSON.stringify({ name: "flarelabs/fasset-bots", version: programVersion() });
                await this.locks.nativeChainLock(this.owner.workAddress).lockAndRun(async () => {
                    await this.agent.agentPingResponse(query, data);
                });
            }
        } catch (error) {
            logger.error(`Error responding to ping for agent ${this.agent.vaultAddress}`, error);
        }
    }

    async enoughTimePassedToObtainProof(request: { proofRequestRound?: number, proofRequestData?: string }) {
        assertNotNull(request.proofRequestRound);
        return await this.context.attestationProvider.flareDataConnector.roundFinalized(request.proofRequestRound + 1);
    }

    /**
     * Updates AgentEntity within a transactional context.
     * @param rootEm root EntityManager to manage the database context
     * @param modify asynchronous callback function that performs modifications on the retrieved AgentEntity
     */
    async updateAgentEntity(rootEm: EM, modify: (agentEnt: AgentEntity) => Promise<void>): Promise<void> {
        await this.runInTransaction(rootEm, async (em) => {
            const agentEnt: AgentEntity = await this.fetchAgentEntity(em);
            await modify(agentEnt);
        });
    }

    /**
     * Fetches AgentEntity
     * @param rootEm root EntityManager to manage the database context
     */
    async fetchAgentEntity(rootEm: EM): Promise<AgentEntity> {
        return await rootEm.findOneOrFail(AgentEntity, { vaultAddress: this.agent.vaultAddress } as FilterQuery<AgentEntity>, { refresh: true });
    }

    async runInTransaction<T>(rootEm: EM, method: (em: EM) => Promise<T>) {
        return await this.locks.databaseLock.lockAndRun(async () => {
            return await rootEm.transactional(async (em) => {
                return await method(em);
            });
        });
    }
}
