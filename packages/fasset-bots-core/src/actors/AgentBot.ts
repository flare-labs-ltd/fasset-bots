import { AddressValidity, ConfirmedBlockHeightExists } from "@flarenetwork/state-connector-protocol";
import { FilterQuery } from "@mikro-orm/core";
import BN from "bn.js";
import { Secrets } from "../config";
import { AgentVaultInitSettings } from "../config/AgentVaultInitSettings";
import { decodedChainId } from "../config/create-wallet-client";
import { EM } from "../config/orm";
import { AgentEntity, Event } from "../entities/agent";
import { IAssetAgentContext } from "../fasset-bots/IAssetBotContext";
import { Agent, OwnerAddressPair } from "../fasset/Agent";
import { AgentInfo, CollateralClass } from "../fasset/AssetManagerTypes";
import { PaymentReference } from "../fasset/PaymentReference";
import { CollateralPrice } from "../state/CollateralPrice";
import { attestationProved } from "../underlying-chain/AttestationHelper";
import { SourceId } from "../underlying-chain/SourceId";
import { TX_SUCCESS } from "../underlying-chain/interfaces/IBlockChain";
import { CommandLineError } from "../utils";
import { EvmEvent, eventOrder } from "../utils/events/common";
import { eventIs } from "../utils/events/truffle";
import { formatArgs, squashSpace } from "../utils/formatting";
import {
    BN_ZERO, BNish, CCB_LIQUIDATION_PREVENTION_FACTOR, DAYS,
    MAX_BIPS, MINUTES, NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR, POOL_COLLATERAL_RESERVE_FACTOR,
    VAULT_COLLATERAL_RESERVE_FACTOR, XRP_ACTIVATE_BALANCE, ZERO_ADDRESS, assertNotNull, errorIncluded, toBN
} from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";
import { NotifierTransport } from "../utils/notifier/BaseNotifier";
import { artifacts, web3 } from "../utils/web3";
import { latestBlockTimestampBN } from "../utils/web3helpers";
import { web3DeepNormalize } from "../utils/web3normalize";
import { AgentBotEventReader } from "./AgentBotEventReader";
import { AgentBotMinting } from "./AgentBotMinting";
import { AgentBotRedemption } from "./AgentBotRedemption";
import { AgentTokenBalances } from "./AgentTokenBalances";

const AgentVault = artifacts.require("AgentVault");
const CollateralPool = artifacts.require("CollateralPool");
const CollateralPoolToken = artifacts.require("CollateralPoolToken");

export interface IRunner {
    stopRequested: boolean;
}

export interface ITimeKeeper {
    latestProof?: ConfirmedBlockHeightExists.Proof;
}

enum ClaimType {
    POOL = "POOL",
    VAULT = "VAULT",
}

export class AgentBot {
    static deepCopyWithObjectCreate = true;

    constructor(
        public agent: Agent,
        public notifier: AgentNotifier,
        public owner: OwnerAddressPair,
        public ownerUnderlyingAddress: string,
    ) {}

    context = this.agent.context;
    eventReader = new AgentBotEventReader(this, this.context, this.notifier, this.agent.vaultAddress);
    minting = new AgentBotMinting(this, this.agent, this.notifier);
    redemption = new AgentBotRedemption(this, this.agent, this.notifier);
    tokens = new AgentTokenBalances(this.context, this.agent.vaultAddress);

    // only set when created by an AgentBotRunner
    runner?: IRunner;
    timekeeper?: ITimeKeeper;

    maxHandleEventBlocks = 1000;
    lastPriceReaderEventBlock = -1;
    waitingForLatestBlockProofSince = BN_ZERO;

    static async createUnderlyingAddress(rootEm: EM, context: IAssetAgentContext) {
        return await rootEm.transactional(async () => await context.wallet.createAccount());
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
        owner: OwnerAddressPair,
        ownerUnderlyingAddress: string,
        addressValidityProof: AddressValidity.Proof,
        agentSettingsConfig: AgentVaultInitSettings,
        notifierTransports: NotifierTransport[]
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
        return await rootEm.transactional(async (em) => {
            const agentEntity = new AgentEntity();
            agentEntity.chainId = context.chainInfo.chainId;
            agentEntity.chainSymbol = context.chainInfo.symbol;
            agentEntity.ownerAddress = agent.owner.managementAddress;
            agentEntity.vaultAddress = agent.vaultAddress;
            agentEntity.underlyingAddress = agent.underlyingAddress;
            agentEntity.active = true;
            agentEntity.currentEventBlock = lastBlock + 1;
            agentEntity.collateralPoolAddress = agent.collateralPool.address;
            em.persist(agentEntity);
            logger.info(squashSpace`Agent ${agent.vaultAddress} was created by owner ${agent.owner},
                underlying address ${agent.underlyingAddress} and collateral pool address ${agent.collateralPool.address}.`);
            const notifier = new AgentNotifier(agent.vaultAddress, notifierTransports);
            return new AgentBot(agent, notifier, owner, ownerUnderlyingAddress);
        });
    }

    /**
     * This method fixes the underlying address to be used by given AgentBot owner.
     * @param context fasset agent bot context
     * @param underlyingAddress agent's underlying address
     * @param ownerAddress agent's owner native address
     */
    static async proveEOAaddress(context: IAssetAgentContext, underlyingAddress: string, owner: OwnerAddressPair): Promise<void> {
        const reference = PaymentReference.addressOwnership(owner.managementAddress);
        // 1 = smallest possible amount (as in 1 satoshi or 1 drop)
        const txHash = await context.wallet.addTransaction(underlyingAddress, underlyingAddress, 1, reference);
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
        agentEntity: AgentEntity,
        ownerUnderlyingAddress: string,
        notifierTransports: NotifierTransport[]
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
        return new AgentBot(agent, notifier, owner, ownerUnderlyingAddress);
    }

    static underlyingAddress(secrets: Secrets, sourceId: SourceId) {
        return secrets.required(`owner.${decodedChainId(sourceId)}.address`);
    }

    /**
     * Activates agent's underlying XRP account by depositing 10 XRP from owner's underlying.
     * @param context fasset agent bot context
     * @param vaultUnderlyingAddress agent's underlying address
     */
    static async activateUnderlyingAccount(context: IAssetAgentContext, owner: OwnerAddressPair, ownerUnderlyingAddress: string, vaultUnderlyingAddress: string): Promise<void> {
        try {
            if (![SourceId.XRP, SourceId.testXRP].includes(context.chainInfo.chainId)) return;
            const starterAmount = XRP_ACTIVATE_BALANCE;
            const reference = owner.managementAddress;
            const txHash = await context.wallet.addTransaction(ownerUnderlyingAddress, vaultUnderlyingAddress, starterAmount, reference);
            const transaction = await context.blockchainIndexer.waitForUnderlyingTransactionFinalization(txHash);
            /* istanbul ignore next */
            if (!transaction || transaction?.status != TX_SUCCESS) {
                throw new Error(`Could not activate or verify new XRP account with transaction ${txHash}`);
            }
            logger.info(`Owner ${owner} activated underlying address ${vaultUnderlyingAddress} with transaction ${txHash}.`);
        } catch (error) {
            logger.error(`Owner ${owner} couldn't activate underlying address ${vaultUnderlyingAddress}:`, error);
            throw new CommandLineError(squashSpace`Could not activate or verify new agent vault's XRP account.
                Note that the owner's XRP account ${ownerUnderlyingAddress} requires at least ${2 * Number(XRP_ACTIVATE_BALANCE) * 1e-6 + 1} XRP to activate the new account.`);
        }
    }

    stopRequested() {
        return this.runner?.stopRequested ?? false;
    }

    /**
     * This is the main method, where "automatic" logic is gathered. In every step it firstly collects unhandled events and runs through them and handles them appropriately.
     * Secondly it checks if there are any redemptions in persistent storage, that needs to be handled.
     * Thirdly, it checks if there are any actions ready to be handled for AgentBot in persistent state (such actions that need announcement beforehand or that are time locked).
     * Lastly, it checks if there are any daily tasks that need to be handled (like mintings or redemptions caught in corner case).
     * @param rootEm entity manager
     */
    async runStep(rootEm: EM): Promise<void> {
        await this.eventReader.troubleshootEvents(rootEm);
        await this.checkForPriceChangeEvents();
        await this.handleEvents(rootEm);
        await this.handleOpenRedemptions(rootEm);
        await this.handleOpenMintings(rootEm);
        await this.handleAgentsWaitingsAndCleanUp(rootEm);
        await this.handleDailyTasks(rootEm);
    }

    /**
     * Performs appropriate actions according to received events.
     * @param rootEm entity manager
     */
    async handleEvents(rootEm: EM): Promise<void> {
        if (this.stopRequested()) return;
        try {
            const agentEnt = await rootEm.findOneOrFail(AgentEntity, { vaultAddress: this.agent.vaultAddress } as FilterQuery<AgentEntity>);
            await agentEnt.events.init();
            const lastEventRead = agentEnt.lastEventRead();
            // eslint-disable-next-line prefer-const
            let [events, lastBlock] = await this.eventReader.readNewEvents(rootEm, this.maxHandleEventBlocks);
            if (lastEventRead !== undefined) {
                events = events.filter((event) => eventOrder(event, lastEventRead) > 0);
            }
            for (const event of events) {
                if (this.stopRequested()) return;
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
                        logger.error(`Agent ${this.agent.vaultAddress} run into error while handling an event:`, error);
                    });
            }
            agentEnt.currentEventBlock = lastBlock + 1;
            await rootEm.persist(agentEnt).flush();
        } catch (error) {
            console.error(`Error handling events for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling events:`, error);
        }
    }

    async handleEvent(em: EM, event: EvmEvent): Promise<void> {
        // only events for this agent should be handled (this should already be the case due to filter in readNewEvents, but just to be sure)
        if (event.args.agentVault && event.args.agentVault.toLowerCase() !== this.agent.vaultAddress.toLowerCase()) return;
        if (eventIs(event, this.context.assetManager, "CollateralReserved")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'CollateralReserved' with data ${formatArgs(event.args)}.`);
            await this.minting.mintingStarted(em, event.args);
        } else if (eventIs(event, this.context.assetManager, "CollateralReservationDeleted")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'CollateralReservationDeleted' with data ${formatArgs(event.args)}.`);
            const minting = await this.minting.findMinting(em, event.args.collateralReservationId);
            await this.minting.mintingExecuted(minting, false);
        } else if (eventIs(event, this.context.assetManager, "MintingExecuted")) {
            if (!event.args.collateralReservationId.isZero()) {
                logger.info(`Agent ${this.agent.vaultAddress} received event 'MintingExecuted' with data ${formatArgs(event.args)}.`);
                const minting = await this.minting.findMinting(em, event.args.collateralReservationId);
                await this.minting.mintingExecuted(minting, true);
            }
        } else if (eventIs(event, this.context.assetManager, "RedemptionRequested")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'RedemptionRequested' with data ${formatArgs(event.args)}.`);
            await this.redemption.redemptionStarted(em, event.args);
        } else if (eventIs(event, this.context.assetManager, "RedemptionDefault")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'RedemptionDefault' with data ${formatArgs(event.args)}.`);
            await this.notifier.sendRedemptionDefaulted(event.args.requestId.toString(), event.args.redeemer);
        } else if (eventIs(event, this.context.assetManager, "RedemptionPerformed")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'RedemptionPerformed' with data ${formatArgs(event.args)}.`);
            await this.redemption.redemptionFinished(em, event.args.requestId);
            await this.notifier.sendRedemptionWasPerformed(event.args.requestId, event.args.redeemer);
        } else if (eventIs(event, this.context.assetManager, "RedemptionPaymentFailed")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'RedemptionPaymentFailed' with data ${formatArgs(event.args)}.`);
            await this.redemption.redemptionFinished(em, event.args.requestId);
            await this.notifier.sendRedemptionFailed(event.args.requestId.toString(), event.args.transactionHash, event.args.redeemer, event.args.failureReason);
        } else if (eventIs(event, this.context.assetManager, "RedemptionPaymentBlocked")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'RedemptionPaymentBlocked' with data ${formatArgs(event.args)}.`);
            await this.redemption.redemptionFinished(em, event.args.requestId);
            await this.notifier.sendRedemptionBlocked(event.args.requestId.toString(), event.args.transactionHash, event.args.redeemer);
        } else if (eventIs(event, this.context.assetManager, "AgentDestroyed")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'AgentDestroyed' with data ${formatArgs(event.args)}.`);
            await this.handleAgentDestruction(em);
        } else if (eventIs(event, this.context.assetManager, "AgentInCCB")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'AgentInCCB' with data ${formatArgs(event.args)}.`);
            await this.notifier.sendCCBAlert(event.args.timestamp);
        } else if (eventIs(event, this.context.assetManager, "LiquidationStarted")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'LiquidationStarted' with data ${formatArgs(event.args)}.`);
            await this.notifier.sendLiquidationStartAlert(event.args.timestamp);
        } else if (eventIs(event, this.context.assetManager, "LiquidationPerformed")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'LiquidationPerformed' with data ${formatArgs(event.args)}.`);
            await this.notifier.sendLiquidationWasPerformed(await this.tokens.fAsset.format(event.args.valueUBA));
        } else if (eventIs(event, this.context.assetManager, "UnderlyingBalanceTooLow")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'UnderlyingBalanceTooLow' with data ${formatArgs(event.args)}.`);
            await this.notifier.sendFullLiquidationAlert(event.args.agentVault);
        } else if (eventIs(event, this.context.assetManager, "DuplicatePaymentConfirmed")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'DuplicatePaymentConfirmed' with data ${formatArgs(event.args)}.`);
            await this.notifier.sendFullLiquidationAlert(event.args.transactionHash1, event.args.transactionHash2);
        } else if (eventIs(event, this.context.assetManager, "IllegalPaymentConfirmed")) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'IllegalPaymentConfirmed' with data ${formatArgs(event.args)}.`);
            await this.notifier.sendFullLiquidationAlert(event.args.transactionHash);
        }
    }

    /**
     * @param rootEm entity manager
     */
    async handleOpenMintings(rootEm: EM): Promise<void> {
        const openMintings = await this.minting.openMintings(rootEm, true);
        logger.info(`Agent ${this.agent.vaultAddress} started handling open mintings #${openMintings.length}.`);
        for (const rd of openMintings) {
            if (this.stopRequested()) return;
            await this.minting.nextMintingStep(rootEm, rd.id);
        }
        logger.info(`Agent ${this.agent.vaultAddress} finished handling open mintings.`);
    }

    /**
     * @param rootEm entity manager
     */
    async handleOpenRedemptions(rootEm: EM): Promise<void> {
        const openRedemptions = await this.redemption.openRedemptions(rootEm, true);
        logger.info(`Agent ${this.agent.vaultAddress} started handling open redemptions #${openRedemptions.length}.`);
        for (const rd of openRedemptions) {
            if (this.stopRequested()) return;
            await this.redemption.nextRedemptionStep(rootEm, rd.id);
        }
        logger.info(`Agent ${this.agent.vaultAddress} finished handling open redemptions.`);
    }


    /**
     * Once a day checks corner cases and claims.
     * @param rootEm entity manager
     */
    async handleDailyTasks(rootEm: EM): Promise<void> {
        if (this.stopRequested()) return;
        const agentEnt = await rootEm.findOneOrFail(AgentEntity, { vaultAddress: this.agent.vaultAddress } as FilterQuery<AgentEntity>);
        const timestamp = await latestBlockTimestampBN();
        if (timestamp.sub(agentEnt.dailyTasksTimestamp).ltn(1 * DAYS)) return;
        const blockHeightProof = await this.getUnderlyingBlockHeightProof();
        if (blockHeightProof == null) return;
        logger.info(`Agent ${this.agent.vaultAddress} is handling daily tasks with block heigh exists proof in round ${blockHeightProof.data.votingRound} for block ${blockHeightProof.data.requestBody.blockNumber}.`);
        await this.handleCornerCases(rootEm);
        await this.checkForClaims();
        agentEnt.dailyTasksTimestamp = toBN(timestamp);
        await rootEm.persistAndFlush(agentEnt);
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
            const ftsoRewardManagerAddress = await this.context.addressUpdater.getContractAddress("FtsoRewardManager");
            const ftsoRewardManager = await IFtsoRewardManager.at(ftsoRewardManagerAddress);
            const addressToClaim = type === ClaimType.VAULT ? this.agent.vaultAddress : this.agent.collateralPool.address;
            const notClaimedRewards: BN[] = await ftsoRewardManager.getEpochsWithUnclaimedRewards(addressToClaim);
            if (notClaimedRewards.length > 0) {
                const unClaimedEpoch = notClaimedRewards[notClaimedRewards.length - 1];
                logger.info(`Agent ${this.agent.vaultAddress} is claiming Ftso rewards for ${addressToClaim} for epochs ${unClaimedEpoch}`);
                if (type === ClaimType.VAULT) {
                    await this.agent.agentVault.claimFtsoRewards(ftsoRewardManager.address, unClaimedEpoch, addressToClaim, { from: this.agent.owner.workAddress });
                } else {
                    await this.agent.collateralPool.claimFtsoRewards(ftsoRewardManager.address, unClaimedEpoch, { from: this.agent.owner.workAddress });
                }
            }
            logger.info(`Agent ${this.agent.vaultAddress} finished checking for claims.`);
        } catch (error) {
            console.error(`Error handling FTSO rewards for ${type} for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling FTSO rewards for ${type}:`, error);
        }
    }

    async checkAirdropClaims(type: ClaimType) {
        try {
            logger.info(`Agent ${this.agent.vaultAddress} started checking for airdrop distribution.`);
            const IDistributionToDelegators = artifacts.require("IDistributionToDelegators");
            const distributionToDelegatorsAddress = await this.context.addressUpdater.getContractAddress("DistributionToDelegators");
            if (distributionToDelegatorsAddress === ZERO_ADDRESS) return;   // DistributionToDelegators does not exist on Songbird/Coston
            const distributionToDelegators = await IDistributionToDelegators.at(distributionToDelegatorsAddress);
            const addressToClaim = type === ClaimType.VAULT ? this.agent.vaultAddress : this.agent.collateralPool.address;
            const { 1: endMonth } = await distributionToDelegators.getClaimableMonths({ from: addressToClaim });
            const claimable = await distributionToDelegators.getClaimableAmountOf(addressToClaim, endMonth);
            if (toBN(claimable).gtn(0)) {
                logger.info(`Agent ${this.agent.vaultAddress} is claiming airdrop distribution for ${addressToClaim} for month ${endMonth}.`);
                if (type === ClaimType.VAULT) {
                    await this.agent.agentVault.claimAirdropDistribution(distributionToDelegators.address, endMonth, addressToClaim, { from: this.agent.owner.workAddress });
                } else {
                    await this.agent.collateralPool.claimAirdropDistribution(distributionToDelegators.address, endMonth, { from: this.agent.owner.workAddress });
                }
            }
            logger.info(`Agent ${this.agent.vaultAddress} finished checking for airdrop distribution.`);
        } catch (error) {
            console.error(`Error handling airdrop distribution for ${type} for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling airdrop distribution for ${type}:`, error);
        }
    }

    /**
     * Checks if any minting or redemption is stuck in corner case.
     * @param rootEm entity manager
     */
    async handleCornerCases(rootEm: EM): Promise<void> {
        try {
            logger.info(`Agent ${this.agent.vaultAddress} started handling corner cases.`);
            await this.redemption.checkOpenRedemptionsForExpiration(rootEm);
            logger.info(`Agent ${this.agent.vaultAddress} finished handling corner cases.`);
        } catch (error) {
            console.error(`Error handling corner cases for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling corner cases:`, error);
        }
    }

    /**
     * Checks and handles if there are any AgentBot actions (withdraw, exit available list, update AgentBot setting) waited to be executed due to required announcement or time lock.
     * @param rootEm entity manager
     */
    async handleAgentsWaitingsAndCleanUp(rootEm: EM): Promise<void> {
        if (this.stopRequested()) return;
        logger.info(`Agent ${this.agent.vaultAddress} started handling 'handleAgentsWaitingsAndCleanUp'.`);
        await rootEm.transactional(async (em) => {
            const agentEnt: AgentEntity = await em.findOneOrFail(AgentEntity, { vaultAddress: this.agent.vaultAddress } as FilterQuery<AgentEntity>);
            const latestTimestamp = await latestBlockTimestampBN();
            await this.handleWaitForAgentDestruction(agentEnt, latestTimestamp, em);
            await this.handleWaitForCollateralWithdrawal(agentEnt, latestTimestamp);
            await this.handleWaitForPoolTokenRedemption(agentEnt, latestTimestamp);
            await this.handleWaitForAgentSettingUpdate(agentEnt, latestTimestamp);
            await this.handleWaitAgentExitAvailable(agentEnt, latestTimestamp);
            await this.handleAgentCloseProcess(agentEnt, latestTimestamp);
            await this.handleUnderlyingWithdrawal(agentEnt, latestTimestamp);
            em.persist(agentEnt);
        });
        logger.info(`Agent ${this.agent.vaultAddress} finished handling 'handleAgentsWaitingsAndCleanUp'.`);
    }

    private async handleWaitForCollateralWithdrawal(agentEnt: AgentEntity, latestTimestamp: BN) {
        if (toBN(agentEnt.withdrawalAllowedAtTimestamp).gt(BN_ZERO)) {
            const successOrExpired = await this.withdrawCollateral(toBN(agentEnt.withdrawalAllowedAtTimestamp), toBN(agentEnt.withdrawalAllowedAtAmount), latestTimestamp, ClaimType.VAULT);
            if (successOrExpired) {
                agentEnt.withdrawalAllowedAtTimestamp = BN_ZERO;
                agentEnt.withdrawalAllowedAtAmount = "";
            }
        }
    }

    private async handleWaitForPoolTokenRedemption(agentEnt: AgentEntity, latestTimestamp: BN) {
        if (toBN(agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp).gt(BN_ZERO)) {
            const successOrExpired = await this.withdrawCollateral(toBN(agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp), toBN(agentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount), latestTimestamp, ClaimType.POOL);
            if (successOrExpired) {
                agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp = BN_ZERO;
                agentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount = "";
            }
        }
    }

    // Agent settings update
    private async handleWaitForAgentSettingUpdate(agentEnt: AgentEntity, latestTimestamp: BN) {
        //Agent update feeBIPS
        if (toBN(agentEnt.agentSettingUpdateValidAtFeeBIPS).gt(BN_ZERO)) {
            const updatedOrExpired = await this.updateAgentSettings(toBN(agentEnt.agentSettingUpdateValidAtFeeBIPS), "feeBIPS", latestTimestamp);
            if (updatedOrExpired) agentEnt.agentSettingUpdateValidAtFeeBIPS = BN_ZERO;
        }
        //Agent update poolFeeShareBIPS
        if (toBN(agentEnt.agentSettingUpdateValidAtPoolFeeShareBIPS).gt(BN_ZERO)) {
            const updatedOrExpired = await this.updateAgentSettings(toBN(agentEnt.agentSettingUpdateValidAtPoolFeeShareBIPS), "poolFeeShareBIPS", latestTimestamp);
            if (updatedOrExpired) agentEnt.agentSettingUpdateValidAtPoolFeeShareBIPS = BN_ZERO;
        }
        //Agent update mintingVaultCollateralRatioBIPS
        if (toBN(agentEnt.agentSettingUpdateValidAtMintingVaultCrBIPS).gt(BN_ZERO)) {
            const updatedOrExpired = await this.updateAgentSettings(toBN(agentEnt.agentSettingUpdateValidAtMintingVaultCrBIPS), "mintingVaultCollateralRatioBIPS", latestTimestamp);
            if (updatedOrExpired) agentEnt.agentSettingUpdateValidAtMintingVaultCrBIPS = BN_ZERO;
        }
        //Agent update mintingPoolCollateralRatioBIPS
        if (toBN(agentEnt.agentSettingUpdateValidAtMintingPoolCrBIPS).gt(BN_ZERO)) {
            const updatedOrExpired = await this.updateAgentSettings(toBN(agentEnt.agentSettingUpdateValidAtMintingPoolCrBIPS), "mintingPoolCollateralRatioBIPS", latestTimestamp);
            if (updatedOrExpired) agentEnt.agentSettingUpdateValidAtMintingPoolCrBIPS = BN_ZERO;
        }
        //Agent update buyFAssetByAgentFactorBIPS
        if (toBN(agentEnt.agentSettingUpdateValidAtBuyFAssetByAgentFactorBIPS).gt(BN_ZERO)) {
            const updatedOrExpired = await this.updateAgentSettings(toBN(agentEnt.agentSettingUpdateValidAtBuyFAssetByAgentFactorBIPS), "buyFAssetByAgentFactorBIPS", latestTimestamp);
            if (updatedOrExpired) agentEnt.agentSettingUpdateValidAtBuyFAssetByAgentFactorBIPS = BN_ZERO;
        }
        //Agent update poolExitCollateralRatioBIPS
        if (toBN(agentEnt.agentSettingUpdateValidAtPoolExitCrBIPS).gt(BN_ZERO)) {
            const updatedOrExpired = await this.updateAgentSettings(toBN(agentEnt.agentSettingUpdateValidAtPoolExitCrBIPS), "poolExitCollateralRatioBIPS", latestTimestamp);
            if (updatedOrExpired) agentEnt.agentSettingUpdateValidAtPoolExitCrBIPS = BN_ZERO;
        }
        //Agent update poolTopupCollateralRatioBIPS
        if (toBN(agentEnt.agentSettingUpdateValidAtPoolTopupCrBIPS).gt(BN_ZERO)) {
            const updatedOrExpired = await this.updateAgentSettings(toBN(agentEnt.agentSettingUpdateValidAtPoolTopupCrBIPS), "poolTopupCollateralRatioBIPS", latestTimestamp);
            if (updatedOrExpired) agentEnt.agentSettingUpdateValidAtPoolTopupCrBIPS = BN_ZERO;
        }
        //Agent update poolTopupTokenPriceFactorBIPS
        if (toBN(agentEnt.agentSettingUpdateValidAtPoolTopupTokenPriceFactorBIPS).gt(BN_ZERO)) {
            const updatedOrExpired = await this.updateAgentSettings(toBN(agentEnt.agentSettingUpdateValidAtPoolTopupTokenPriceFactorBIPS), "poolTopupTokenPriceFactorBIPS", latestTimestamp);
            if (updatedOrExpired) agentEnt.agentSettingUpdateValidAtPoolTopupTokenPriceFactorBIPS = BN_ZERO;
        }
    }

    private async handleAgentCloseProcess(agentEnt: AgentEntity, latestTimestamp: BN) {
        if (!agentEnt.waitingForDestructionCleanUp) return;
        const agentInfo = await this.agent.getAgentInfo();
        if (agentInfo.publiclyAvailable) return;
        const waitingCollateralWithdrawal = toBN(agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp).gt(BN_ZERO);
        const waitingPoolTokenRedemption = toBN(agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp).gt(BN_ZERO);
        if (waitingCollateralWithdrawal || waitingPoolTokenRedemption) {
            // vault collateral withdrawal
            if (waitingCollateralWithdrawal) {
                logger.debug(`Agent ${this.agent.vaultAddress} is waiting for collateral withdrawal before destruction.`);
                const withdrawAllowedAt = toBN(agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp);
                const withdrawAmount = toBN(agentEnt.destroyVaultCollateralWithdrawalAllowedAtAmount);
                const successOrExpired = await this.withdrawCollateral(withdrawAllowedAt, withdrawAmount, latestTimestamp, ClaimType.VAULT);
                if (successOrExpired) {
                    agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp = BN_ZERO;
                    agentEnt.destroyVaultCollateralWithdrawalAllowedAtAmount = "";
                }
            }
            // pool token redemption
            if (waitingPoolTokenRedemption) {
                logger.debug(`Agent ${this.agent.vaultAddress} is waiting for pool token redemption before destruction.`);
                const withdrawAllowedAt = toBN(agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp);
                const withdrawAmount = toBN(agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtAmount);
                const successOrExpired = await this.withdrawCollateral(withdrawAllowedAt, withdrawAmount, latestTimestamp, ClaimType.POOL);
                if (successOrExpired) {
                    agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp = BN_ZERO;
                    agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtAmount = "";
                }
            }
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} is checking if clean up before destruction is complete.`);
            // agent checks if clean up is complete
            // withdraw and self close pool fees
            const poolFeeBalance = await this.agent.poolFeeBalance();
            if (poolFeeBalance.gt(BN_ZERO)) {
                await this.agent.withdrawPoolFees(poolFeeBalance);
                await this.agent.selfClose(poolFeeBalance);
                logger.info(`Agent ${this.agent.vaultAddress} withdrew and self closed pool fees ${poolFeeBalance}.`);
            }
            // check poolTokens and vaultCollateralBalance
            const agentInfoForCollateral = await this.agent.getAgentInfo();
            const freeVaultCollateralBalance = toBN(agentInfoForCollateral.freeVaultCollateralWei);
            if (freeVaultCollateralBalance.gt(BN_ZERO)) {
                // announce withdraw class 1
                agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp = await this.agent.announceVaultCollateralWithdrawal(freeVaultCollateralBalance);
                agentEnt.destroyVaultCollateralWithdrawalAllowedAtAmount = freeVaultCollateralBalance.toString();
                logger.info(`Agent ${this.agent.vaultAddress} announced vault collateral withdrawal ${freeVaultCollateralBalance} at ${agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp}.`);
            }
            // check poolTokens
            const poolTokenBalance = toBN(await this.agent.collateralPoolToken.balanceOf(this.agent.vaultAddress));
            const agentInfoForPoolTokens = await this.agent.getAgentInfo();
            if (poolTokenBalance.gt(BN_ZERO) && this.hasNoBackedFAssets(agentInfoForPoolTokens)) {
                // announce redeem pool tokens and wait for others to do so (pool needs to be empty)
                agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp = await this.agent.announcePoolTokenRedemption(poolTokenBalance);
                agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtAmount = poolTokenBalance.toString();
                logger.info(`Agent ${this.agent.vaultAddress} announced pool token redemption ${poolTokenBalance} at ${agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp}.`);
            }
            const agentInfoForDestroy = await this.agent.getAgentInfo();
            const totalPoolTokens = toBN(await this.agent.collateralPoolToken.totalSupply());
            // and wait for others to redeem
            if (totalPoolTokens.eq(BN_ZERO) && this.hasNoBackedFAssets(agentInfoForDestroy)) {
                // agent checks if clean is complete, agent can announce destroy
                const destroyAllowedAt = await this.agent.announceDestroy();
                agentEnt.waitingForDestructionTimestamp = destroyAllowedAt;
                agentEnt.waitingForDestructionCleanUp = false;
                await this.notifier.sendAgentAnnounceDestroy();
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
    }

    private hasNoBackedFAssets(agentInfo: AgentInfo) {
        return toBN(agentInfo.mintedUBA).eq(BN_ZERO) && toBN(agentInfo.redeemingUBA).eq(BN_ZERO) &&
            toBN(agentInfo.reservedUBA).eq(BN_ZERO) && toBN(agentInfo.poolRedeemingUBA).eq(BN_ZERO);
    }

    private async handleWaitForAgentDestruction(agentEnt: AgentEntity, latestTimestamp: BN, em: EM) {
        if (toBN(agentEnt.waitingForDestructionTimestamp).gt(BN_ZERO)) {
            logger.info(`Agent ${this.agent.vaultAddress} is waiting for destruction.`);
            // agent waiting for destruction
            if (toBN(agentEnt.waitingForDestructionTimestamp).lte(latestTimestamp)) {
                // agent can be destroyed
                await this.agent.destroy();
                agentEnt.waitingForDestructionTimestamp = BN_ZERO;
                await this.handleAgentDestruction(em);
            } else {
                logger.info(`Agent ${this.agent.vaultAddress} cannot be destroyed. Allowed at ${agentEnt.waitingForDestructionTimestamp}. Current ${latestTimestamp}.`);
            }
        }
    }

    private async handleUnderlyingWithdrawal(agentEnt: AgentEntity, latestTimestamp: BN) {
        // confirm underlying withdrawal
        if (toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).gt(BN_ZERO)) {
            logger.info(`Agent ${this.agent.vaultAddress} is waiting for confirming underlying withdrawal.`);
            // agent waiting for underlying withdrawal
            if (agentEnt.underlyingWithdrawalConfirmTransaction.length) {
                const settings = await this.context.assetManager.getSettings();
                const announcedUnderlyingConfirmationMinSeconds = toBN(settings.announcedUnderlyingConfirmationMinSeconds);
                if (toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).add(announcedUnderlyingConfirmationMinSeconds).lt(latestTimestamp)) {
                    // agent can confirm underlying withdrawal
                    await this.agent.confirmUnderlyingWithdrawal(agentEnt.underlyingWithdrawalConfirmTransaction);
                    await this.notifier.sendConfirmWithdrawUnderlying();
                    logger.info(`Agent ${this.agent.vaultAddress} confirmed underlying withdrawal transaction ${agentEnt.underlyingWithdrawalConfirmTransaction}.`);
                    agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = BN_ZERO;
                    agentEnt.underlyingWithdrawalConfirmTransaction = "";
                } else {
                    const withdrawalAllowedAt = toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).add(announcedUnderlyingConfirmationMinSeconds);
                    logger.info(`Agent ${this.agent.vaultAddress} cannot yet confirm underlying withdrawal. Allowed at ${withdrawalAllowedAt}. Current ${latestTimestamp}.`);
                }
            }
        }
        // cancel underlying withdrawal
        if (agentEnt.underlyingWithdrawalWaitingForCancelation) {
            logger.info(`Agent ${this.agent.vaultAddress} is waiting for canceling underlying withdrawal.`);
            const settings = await this.context.assetManager.getSettings();
            const announcedUnderlyingConfirmationMinSeconds = toBN(settings.announcedUnderlyingConfirmationMinSeconds);
            if (toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).add(announcedUnderlyingConfirmationMinSeconds).lt(latestTimestamp)) {
                // agent can confirm cancel withdrawal announcement
                await this.agent.cancelUnderlyingWithdrawal();
                await this.notifier.sendCancelWithdrawUnderlying();
                logger.info(`Agent ${this.agent.vaultAddress} canceled underlying withdrawal transaction ${agentEnt.underlyingWithdrawalConfirmTransaction}.`);
                agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = BN_ZERO;
                agentEnt.underlyingWithdrawalConfirmTransaction = "";
                agentEnt.underlyingWithdrawalWaitingForCancelation = false;
            } else {
                logger.info(`Agent ${this.agent.vaultAddress} cannot yet cancel underlying withdrawal. Allowed at ${toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp)}. Current ${latestTimestamp}.`);
            }
        }
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
        logger.info(`Agent ${this.agent.vaultAddress} is waiting to withdraw ${type} collateral.`);
        // agent waiting for pool token redemption
        if (toBN(withdrawValidAt).lte(latestTimestamp)) {
            // agent can withdraw vault collateral
            const token = type === ClaimType.VAULT ? this.tokens.vaultCollateral : this.tokens.poolCollateral;
            try {
                if (type === ClaimType.VAULT) {
                    await this.agent.withdrawVaultCollateral(withdrawAmount);
                    await this.notifier.sendWithdrawVaultCollateral(await token.format(withdrawAmount));
                } else {
                    await this.agent.redeemCollateralPoolTokens(withdrawAmount);
                    await this.notifier.sendRedeemCollateralPoolTokens(await token.format(withdrawAmount));
                }
                logger.info(`Agent ${this.agent.vaultAddress} withdrew ${type} collateral ${withdrawAmount}.`);
                return true;
            } catch (error) {
                if (errorIncluded(error, ["withdrawal: too late", "withdrawal: CR too low"])) {
                    await this.notifier.sendAgentCannotWithdrawCollateral(await token.format(withdrawAmount), type);
                    return true;
                }
                logger.error(`Agent ${this.agent.vaultAddress} run into error while withdrawing ${type} collateral:`, error);
            }
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} cannot withdraw ${type} collateral. Allowed at ${withdrawValidAt}. Current ${latestTimestamp}.`);
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
        logger.info(`Agent ${this.agent.vaultAddress} is waiting for ${settingsName} agent setting update.`);
        // agent waiting for setting update
        if (toBN(settingValidAt).lte(latestTimestamp)) {
            // agent can update setting
            try {
                await this.agent.executeAgentSettingUpdate(settingsName);
                await this.notifier.sendAgentSettingsUpdate(settingsName);
                return true;
            } catch (error) {
                if (errorIncluded(error, ["update not valid anymore"])) {
                    await this.notifier.sendAgentCannotUpdateSettingExpired(settingsName);
                    return true;
                }
                logger.error(`Agent ${this.agent.vaultAddress} run into error while updating setting ${settingsName}:`, error);
            }
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} cannot update agent setting ${settingsName}. Allowed at ${settingValidAt}. Current ${latestTimestamp}.`);
        }
        return false;
    }

    /**
     * AgentBot exits available if already allowed
     * @param agentEnt agent entity
     */
    async handleWaitAgentExitAvailable(agentEnt: AgentEntity, latestTimestamp: BN) {
        if (this.anouncementStatus(agentEnt.exitAvailableAllowedAtTimestamp, latestTimestamp) !== "ALLOWED") return;
        await this.exitAvailable(agentEnt);
    }

    async exitAvailable(agentEnt: AgentEntity) {
        await this.agent.exitAvailable();
        agentEnt.exitAvailableAllowedAtTimestamp = BN_ZERO;
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
        return this.anouncementStatus(agentEnt.exitAvailableAllowedAtTimestamp, await latestBlockTimestampBN());
    }

    /**
     * Return status of any action requiring announcement (wwthdrawal, exit, etc.)
     * @param actionAllowedAt the saved timestamp of ehen the action is allowed
     * @param currentTimestamp the current timestamp
     * @returns current status: NOT_ANNOUNCED -> WAITING -> ALLOWED
     */
    anouncementStatus(actionAllowedAt: BNish, currentTimestamp: BN) {
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
        logger.info(`Agent ${this.agent.vaultAddress} is trying to check if transaction (proof) can still be obtained from indexer.`);
        // try to get proof whether payment/non-payment proofs have expired
        const proof = await this.getUnderlyingBlockHeightProof();
        if (proof) {
            const lqwBlock = toBN(proof.data.responseBody.lowestQueryWindowBlockNumber);
            const lqwBTimestamp = toBN(proof.data.responseBody.lowestQueryWindowBlockTimestamp);
            if (lqwBlock.gt(lastUnderlyingBlock) && lqwBTimestamp.gt(lastUnderlyingTimestamp)) {
                logger.info(`Agent ${this.agent.vaultAddress} confirmed that transaction (proof) CANNOT be obtained from indexer.`);
                return proof;
            } else {
                logger.info(`Agent ${this.agent.vaultAddress} confirmed that transaction (proof) CAN be obtained from indexer.`);
                return "NOT_EXPIRED";
            }
        }
        return "WAITING_PROOF";
    }

    /**
     * Get the latest underlying block height exists proof from the timekeeper or
     * @returns
     */
    async getUnderlyingBlockHeightProof() {
        assertNotNull(this.timekeeper, "Cannot obtain underlying block height - timekeeper not set.");
        // obtain the proof
        const proof = this.timekeeper.latestProof;
        if (attestationProved(proof)) {
            this.waitingForLatestBlockProofSince = BN_ZERO;
            return proof;
        }
        // if waiting for proof for more than expected time, notify agent and restart wait
        const timestamp = await latestBlockTimestampBN();
        if (this.waitingForLatestBlockProofSince.gt(BN_ZERO) && timestamp.sub(this.waitingForLatestBlockProofSince).gtn(10 * MINUTES)) {
            await this.notifier.sendDailyTaskNoProofObtained(10);
            this.waitingForLatestBlockProofSince = timestamp;
        }
        // start waiting for proof
        if (this.waitingForLatestBlockProofSince.eq(BN_ZERO)) {
            this.waitingForLatestBlockProofSince = timestamp;
        }
    }

    /**
     * Marks stored AgentBot in persistent state as inactive after event 'AgentDestroyed' is received.
     * @param em entity manager
     * @param vaultAddress agent's vault address
     */
    async handleAgentDestruction(em: EM): Promise<void> {
        const agentEnt = await em.findOneOrFail(AgentEntity, { vaultAddress: this.agent.vaultAddress } as FilterQuery<AgentEntity>);
        agentEnt.active = false;
        await this.notifier.sendAgentDestroyed();
        logger.info(`Agent ${this.agent.vaultAddress} was destroyed.`);
    }

    /**
     * Checks AgentBot's and owner's underlying balance after redemption is finished. If AgentBot's balance is too low, it tries to top it up from owner's account. See 'underlyingTopUp(...)'.
     * @param agentVault agent's vault address
     */
    async checkUnderlyingBalance(): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is checking free underlying balance.`);
        const freeUnderlyingBalance = toBN((await this.agent.getAgentInfo()).freeUnderlyingBalanceUBA);
        logger.info(`Agent's ${this.agent.vaultAddress} free underlying balance is ${freeUnderlyingBalance}.`);
        const estimatedFee = toBN(await this.context.wallet.getTransactionFee());
        logger.info(`Agent's ${this.agent.vaultAddress} calculated estimated underlying fee is ${estimatedFee}.`);
        if (freeUnderlyingBalance.lte(estimatedFee.muln(NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR))) {
            await this.underlyingTopUp(estimatedFee.muln(NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR), freeUnderlyingBalance);
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} doesn't need underlying top up.`);
        }
    }

    /**
     * Tries to top up AgentBot's underlying account from owner's. It notifies about successful and unsuccessful try.
     * It also checks owner's underlying balance and notifies when it is too low.
     * @param amount amount to transfer from owner's underlying address to agent's underlying address
     * @param agentVault agent's vault address
     * @param freeUnderlyingBalance agent's free underlying balance
     */
    async underlyingTopUp(amount: BN, freeUnderlyingBalance: BN): Promise<void> {
        try {
            const amountF = await this.tokens.underlying.format(amount);
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} is trying to top up underlying address ${this.agent.underlyingAddress}
                from owner's underlying address ${this.ownerUnderlyingAddress}.`);
            const txHash = await this.agent.performTopupPayment(amount, this.ownerUnderlyingAddress);
            await this.agent.confirmTopupPayment(txHash);
            await this.notifier.sendLowUnderlyingAgentBalance(amountF);
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} topped up underlying address ${this.agent.underlyingAddress} with amount
                ${amountF} from owner's underlying address ${this.ownerUnderlyingAddress} with txHash ${txHash}.`);
        } catch (error) {
            const freeBalanceF = await this.tokens.underlying.format(freeUnderlyingBalance);
            await this.notifier.sendLowUnderlyingAgentBalanceFailed(freeBalanceF);
            logger.error(squashSpace`Agent ${this.agent.vaultAddress} has low free underlying balance ${freeBalanceF} on underlying address
                ${this.agent.underlyingAddress} and could not be topped up from owner's underlying address ${this.ownerUnderlyingAddress}:`, error);
        }
        await this.checkForLowOwnerUnderlyingBalance();
    }

    async checkForLowOwnerUnderlyingBalance() {
        const ownerUnderlyingBalance = await this.context.wallet.getBalance(this.ownerUnderlyingAddress);
        const estimatedFee = toBN(await this.context.wallet.getTransactionFee());
        const expectedBalance = estimatedFee.muln(NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR);
        const balanceF = await this.tokens.underlying.format(ownerUnderlyingBalance);
        const expectedBalanceF = await this.tokens.underlying.format(expectedBalance);
        if (ownerUnderlyingBalance.lte(expectedBalance)) {
            await this.notifier.sendLowBalanceOnUnderlyingOwnersAddress(this.ownerUnderlyingAddress, balanceF);
            logger.info(squashSpace`Agent's ${this.agent.vaultAddress} owner ${this.agent.owner.managementAddress} has low balance
                ${balanceF} on underlying address ${this.ownerUnderlyingAddress}. Expected to have at least ${expectedBalanceF}.`);
        } else {
            logger.info(squashSpace`Agent's ${this.agent.vaultAddress} owner ${this.agent.owner.managementAddress} has ${balanceF}
                on underlying address ${this.ownerUnderlyingAddress}.`);
        }
    }

    /**
     * Check if any new PriceEpochFinalized events happened, which means that it may be necessary to topup collateral.
     */
    async checkForPriceChangeEvents() {
        let needToCheckPrices: boolean;
        if (this.lastPriceReaderEventBlock >= 0) {
            [needToCheckPrices, this.lastPriceReaderEventBlock] = await this.eventReader.priceChangeEventHappened(this.lastPriceReaderEventBlock + 1);
        } else {
            needToCheckPrices = true;   // this is first time in this method, so check is necessary
            this.lastPriceReaderEventBlock = await this.eventReader.lastFinalizedBlock() + 1;
        }
        if (needToCheckPrices) {
            logger.info(`Agent ${this.agent.vaultAddress} received event 'PriceEpochFinalized'.`);
            await this.checkAgentForCollateralRatiosAndTopUp();
        }
    }

    /**
     * Checks both AgentBot's collateral ratios. In case of either being unhealthy, it tries to top up from owner's account in order to get out of Collateral Ratio Band or Liquidation due to price changes.
     * It sends notification about successful and unsuccessful top up.
     * At the end it also checks owner's balance and notifies when too low.
     */
    async checkAgentForCollateralRatiosAndTopUp(): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is checking collateral ratios.`);
        const agentInfo = await this.agent.getAgentInfoIfExists();
        if (agentInfo == null) return;
        await this.checkForVaultCollateralTopup(agentInfo);
        await this.checkForPoolCollateralTopup(agentInfo);
        logger.info(`Agent ${this.agent.vaultAddress} finished checking for collateral topups.`);
        await this.checkOwnerVaultCollateralBalance(agentInfo);
        await this.checkOwnerNativeBalance(agentInfo);
    }

    async checkForVaultCollateralTopup(agentInfo: AgentInfo) {
        const vaultCollateralPrice = await this.agent.getVaultCollateralPrice();
        const requiredCrVaultCollateralBIPS = toBN(vaultCollateralPrice.collateral.ccbMinCollateralRatioBIPS).muln(CCB_LIQUIDATION_PREVENTION_FACTOR);
        const requiredTopUpVaultCollateral = await this.requiredTopUp(requiredCrVaultCollateralBIPS, agentInfo, vaultCollateralPrice);
        if (requiredTopUpVaultCollateral.gt(BN_ZERO)) {
            const requiredTopUpF = await this.tokens.vaultCollateral.format(requiredTopUpVaultCollateral);
            try {
                logger.info(`Agent ${this.agent.vaultAddress} is trying to top up vault collateral ${requiredTopUpF} from owner ${this.agent.owner}.`);
                await this.agent.depositVaultCollateral(requiredTopUpVaultCollateral);
                await this.notifier.sendVaultCollateralTopUpAlert(requiredTopUpF);
                logger.info(`Agent ${this.agent.vaultAddress} topped up vault collateral ${requiredTopUpF} from owner ${this.agent.owner}.`);
            } catch (err) {
                await this.notifier.sendVaultCollateralTopUpFailedAlert(requiredTopUpF);
                logger.error(`Agent ${this.agent.vaultAddress} could not be topped up with vault collateral ${requiredTopUpF} from owner ${this.agent.owner}:`, err);
            }
        }
    }

    async checkForPoolCollateralTopup(agentInfo: AgentInfo) {
        const poolCollateralPrice = await this.agent.getPoolCollateralPrice();
        const requiredCrPoolBIPS = toBN(poolCollateralPrice.collateral.ccbMinCollateralRatioBIPS).muln(CCB_LIQUIDATION_PREVENTION_FACTOR);
        const requiredTopUpPool = await this.requiredTopUp(requiredCrPoolBIPS, agentInfo, poolCollateralPrice);
        if (requiredTopUpPool.gt(BN_ZERO)) {
            const requiredTopUpF = await this.tokens.poolCollateral.format(requiredTopUpPool);
            try {
                logger.info(`Agent ${this.agent.vaultAddress} is trying to buy collateral pool tokens ${requiredTopUpF} from owner ${this.agent.owner}.`);
                await this.agent.buyCollateralPoolTokens(requiredTopUpPool);
                await this.notifier.sendPoolCollateralTopUpAlert(requiredTopUpF);
                logger.info(`Agent ${this.agent.vaultAddress} bought collateral pool tokens ${requiredTopUpF} from owner ${this.agent.owner}.`);
            } catch (err) {
                await this.notifier.sendPoolCollateralTopUpFailedAlert(requiredTopUpF);
                logger.error(`Agent ${this.agent.vaultAddress} could not buy collateral pool tokens ${requiredTopUpF} from owner ${this.agent.owner}:`, err);
            }
        }
    }

    async checkOwnerVaultCollateralBalance(agentInfo: AgentInfo) {
        const ownerBalanceVaultCollateral = await this.tokens.vaultCollateral.balance(this.agent.owner.workAddress);
        const vaultCollateralLowBalance = this.ownerVaultCollateralLowBalance(agentInfo);
        if (ownerBalanceVaultCollateral.lte(vaultCollateralLowBalance)) {
            const vaultBalanceF = await this.tokens.vaultCollateral.format(ownerBalanceVaultCollateral);
            await this.notifier.sendLowBalanceOnOwnersAddress(this.agent.owner.workAddress, vaultBalanceF);
            logger.info(`Agent's ${this.agent.vaultAddress} owner ${this.agent.owner} has low vault collateral balance ${vaultBalanceF}.`);
        }
    }

    async checkOwnerNativeBalance(agentInfo: AgentInfo) {
        const ownerBalanceNative = await this.tokens.native.balance(this.agent.owner.workAddress);
        const nativeLowBalance = this.ownerNativeLowBalance(agentInfo);
        if (ownerBalanceNative.lte(nativeLowBalance)) {
            const nativeBalanceF = await this.tokens.native.format(ownerBalanceNative);
            await this.notifier.sendLowBalanceOnOwnersAddress(this.agent.owner.workAddress, nativeBalanceF);
            logger.info(`Agent's ${this.agent.vaultAddress} owner ${this.agent.owner} has low native balance ${nativeBalanceF}.`);
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
        const balance = toBN(Number(cp.collateral.collateralClass) == CollateralClass.VAULT ? agentInfo.totalVaultCollateralWei : agentInfo.totalPoolCollateralNATWei);
        const totalUBA = toBN(agentInfo.mintedUBA).add(toBN(agentInfo.reservedUBA)).add(toBN(redeemingUBA));
        const backingVaultCollateralWei = cp.convertUBAToTokenWei(totalUBA);
        const requiredCollateral = backingVaultCollateralWei.mul(requiredCrBIPS).divn(MAX_BIPS);
        return requiredCollateral.sub(balance);
    }

    private ownerNativeLowBalance(agentInfo: AgentInfo): BN {
        const lockedPoolCollateral = toBN(agentInfo.totalPoolCollateralNATWei).sub(toBN(agentInfo.freePoolCollateralNATWei));
        return lockedPoolCollateral.muln(POOL_COLLATERAL_RESERVE_FACTOR);
    }

    private ownerVaultCollateralLowBalance(agentInfo: AgentInfo): BN {
        const lockedVaultCollateral = toBN(agentInfo.totalVaultCollateralWei).sub(toBN(agentInfo.freeVaultCollateralWei));
        return lockedVaultCollateral.muln(VAULT_COLLATERAL_RESERVE_FACTOR);
    }
}
