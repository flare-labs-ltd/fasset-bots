import { FilterQuery, RequiredEntityData } from "@mikro-orm/core/typings";
import { CollateralReserved, RedemptionRequested } from "../../typechain-truffle/AssetManager";
import { EM } from "../config/orm";
import { AgentEntity, AgentMinting, AgentMintingState, AgentRedemption, AgentRedemptionState } from "../entities/agent";
import { AgentB } from "../fasset-bots/AgentB";
import { AgentBotDefaultSettings, IAssetAgentBotContext } from "../fasset-bots/IAssetBotContext";
import { AgentInfo, AgentSettings, CollateralClass } from "../fasset/AssetManagerTypes";
import { PaymentReference } from "../fasset/PaymentReference";
import { ProvedDH } from "../underlying-chain/AttestationHelper";
import { artifacts } from "../utils/artifacts";
import { EventArgs, EvmEvent } from "../utils/events/common";
import { eventIs, requiredEventArgs } from "../utils/events/truffle";
import { Web3EventDecoder } from "../utils/events/Web3EventDecoder";
import { BN_ZERO, CCB_LIQUIDATION_PREVENTION_FACTOR, DAYS, MAX_BIPS, NATIVE_LOW_BALANCE, NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR, STABLE_COIN_LOW_BALANCE, requireEnv, toBN } from "../utils/helpers";
import { Notifier } from "../utils/Notifier";
import { web3 } from "../utils/web3";
import { DHConfirmedBlockHeightExists, DHPayment, DHReferencedPaymentNonexistence } from "../verification/generated/attestation-hash-types";
import { latestBlockTimestampBN } from "../utils/web3helpers";
import { CollateralPrice } from "../state/CollateralPrice";
import { attestationWindowSeconds, latestUnderlyingBlock } from "../utils/fasset-helpers";
import { web3DeepNormalize } from "../utils/web3normalize";
import {formatArgs, logger } from "../../logger";
import { min } from "bn.js";

const AgentVault = artifacts.require('AgentVault');
const ContingencyPool = artifacts.require('ContingencyPool');
const ContingencyPoolToken = artifacts.require('ContingencyPoolToken');
const IERC20 = artifacts.require('IERC20');

export class AgentBot {
    constructor(
        public agent: AgentB,
        public notifier: Notifier
    ) { }

    context = this.agent.context;
    eventDecoder = new Web3EventDecoder({ assetManager: this.context.assetManager, ftsoManager: this.context.ftsoManager });
    latestProof: ProvedDH<DHConfirmedBlockHeightExists> | null = null;

    /**
     *
     * Creates AgentBot with newly created underlying address and with provided agent default settings.
     * Certain AgentBot properties are also stored in persistent state.
     */
    static async create(rootEm: EM, context: IAssetAgentBotContext, ownerAddress: string, agentSettingsConfig: AgentBotDefaultSettings, notifier: Notifier): Promise<AgentBot> {
        logger.info(`Starting to create agent for owner ${ownerAddress} with settings ${JSON.stringify(agentSettingsConfig)}.`);
        const lastBlock = await web3.eth.getBlockNumber();
        return await rootEm.transactional(async em => {
            const underlyingAddress = await context.wallet.createAccount();
            const settings = await context.assetManager.getSettings();
            if (settings.requireEOAAddressProof) {
                await this.proveEOAaddress(context, underlyingAddress, ownerAddress);
            }
            const agentSettings: AgentSettings = { underlyingAddressString: underlyingAddress, ...agentSettingsConfig };
            const agent = await AgentB.create(context, ownerAddress, agentSettings);
            const agentEntity = new AgentEntity();
            agentEntity.chainId = context.chainInfo.chainId;
            agentEntity.ownerAddress = agent.ownerAddress;
            agentEntity.vaultAddress = agent.vaultAddress;
            agentEntity.underlyingAddress = agent.underlyingAddress;
            agentEntity.active = true;
            agentEntity.lastEventBlockHandled = lastBlock;
            agentEntity.contingencyPoolAddress = agent.contingencyPool.address
            em.persist(agentEntity);
            logger.info(`Agent ${agent.vaultAddress} was created by owner ${agent.ownerAddress} with underlying address ${agent.underlyingAddress} and collateral pool address ${agent.collateralPool.address}.`);
            return new AgentBot(agent, notifier);
        });
    }

    /**
     * This method fixes the underlying address to be used by given AgentBot owner.
     */
    static async proveEOAaddress(context: IAssetAgentBotContext, underlyingAddress: string, ownerAddress: string): Promise<void> {
        // 1 = smallest possible amount (as in 1 satoshi or 1 drop)
        const txHash = await context.wallet.addTransaction(underlyingAddress, underlyingAddress, 1, PaymentReference.addressOwnership(ownerAddress));
        await context.blockchainIndexer.waitForUnderlyingTransactionFinalization(txHash);
        const proof = await context.attestationProvider.provePayment(txHash, underlyingAddress, underlyingAddress);
        await context.assetManager.proveUnderlyingAddressEOA(web3DeepNormalize(proof), { from: ownerAddress });
    }

    /**
     * Create AgentBot from persistent state.
     */
    static async fromEntity(context: IAssetAgentBotContext, agentEntity: AgentEntity, notifier: Notifier): Promise<AgentBot> {
        logger.info(`Starting to recreate agent ${agentEntity.vaultAddress} from DB for owner ${agentEntity.ownerAddress}.`);
        const agentVault = await AgentVault.at(agentEntity.vaultAddress);
        // get contingency pool
        const contingencyPool = await ContingencyPool.at(agentEntity.contingencyPoolAddress);
        // get pool token
        const poolTokenAddress = await contingencyPool.poolToken();
        const contingencyPoolToken = await ContingencyPoolToken.at(poolTokenAddress);
        // agent
        const agent = new AgentB(context, agentEntity.ownerAddress, agentVault, contingencyPool, contingencyPoolToken, agentEntity.underlyingAddress);
        logger.info(`Agent ${agent.vaultAddress} was restore from DB by owner ${agent.ownerAddress} with underlying address ${agent.underlyingAddress} and collateral pool address ${agent.collateralPool.address}.`);
        return new AgentBot(agent, notifier);
    }

    /**
     * This is the main method, where "automatic" logic is gathered. In every step it firstly collects unhandled events and runs through them and handles them appropriately.
     * Secondly it checks if there are any redemptions in persistent storage, that needs to be handled.
     * Thirdly, it checks if there are any actions ready to be handled for AgentBot in persistent state (such actions that need announcement beforehand or that are time locked).
     * Lastly, it checks if there are any mintings or redemptions caught in corner case.
     */
    async runStep(rootEm: EM): Promise<void> {
        await this.handleEvents(rootEm);
        await this.handleOpenRedemptions(rootEm);
        await this.handleAgentsWaitingsAndCleanUp(rootEm);
        await this.handleCornerCases(rootEm);
    }

    /**
     * Performs appropriate actions according to received events.
     */
    async handleEvents(rootEm: EM): Promise<void> {
        await rootEm.transactional(async em => {
            const events = await this.readUnhandledEvents(em);
            // Note: only update db here, so that retrying on error won't retry on-chain operations.
            for (const event of events) {
                if (eventIs(event, this.context.assetManager, 'CollateralReserved')) {
                    logger.info(`Agent ${this.agent.vaultAddress} received event 'CollateralReserved' with data ${formatArgs(event)}.`);
                    this.mintingStarted(em, event.args);
                } else if (eventIs(event, this.context.assetManager, 'CollateralReservationDeleted')) {
                    logger.info(`Agent ${this.agent.vaultAddress} received event 'CollateralReservationDeleted' with data ${formatArgs(event)}.`);
                    const minting = await this.findMinting(em, event.args.collateralReservationId);
                    this.mintingExecuted(minting, false);
                } else if (eventIs(event, this.context.assetManager, 'MintingExecuted')) {
                    if (!event.args.collateralReservationId.isZero()) {
                        logger.info(`Agent ${this.agent.vaultAddress} received event 'MintingExecuted' with data ${formatArgs(event)}.`);
                        const minting = await this.findMinting(em, event.args.collateralReservationId);
                        this.mintingExecuted(minting, true);
                    }
                } else if (eventIs(event, this.context.assetManager, 'RedemptionRequested')) {
                    logger.info(`Agent ${this.agent.vaultAddress} received event 'RedemptionRequested' with data ${formatArgs(event)}.`);
                    this.redemptionStarted(em, event.args);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionDefault')) {
                    logger.info(`Agent ${this.agent.vaultAddress} received event 'RedemptionDefault' with data ${formatArgs(event)}.`);
                    this.notifier.sendRedemptionDefaulted(event.args.requestId.toString(), event.args.redeemer, event.args.agentVault);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionPerformed')) {
                    logger.info(`Agent ${this.agent.vaultAddress} received event 'RedemptionPerformed' with data ${formatArgs(event)}.`);
                    await this.redemptionFinished(em, event.args.requestId, event.args.agentVault);
                    this.notifier.sendRedemptionWasPerformed(event.args.requestId, event.args.redeemer, event.args.agentVault);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionPaymentFailed')) {
                    logger.info(`Agent ${this.agent.vaultAddress} received event 'RedemptionPaymentFailed' with data ${formatArgs(event)}.`);
                    await this.redemptionFinished(em, event.args.requestId, event.args.agentVault);
                    this.notifier.sendRedemptionFailedOrBlocked(event.args.requestId.toString(), event.args.transactionHash, event.args.redeemer, event.args.agentVault, event.args.failureReason);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionPaymentBlocked')) {
                    logger.info(`Agent ${this.agent.vaultAddress} received event 'RedemptionPaymentBlocked' with data ${formatArgs(event)}.`);
                    await this.redemptionFinished(em, event.args.requestId, event.args.agentVault);
                    this.notifier.sendRedemptionFailedOrBlocked(event.args.requestId.toString(), event.args.transactionHash, event.args.redeemer, event.args.agentVault);
                } else if (eventIs(event, this.context.assetManager, 'AgentDestroyed')) {
                    logger.info(`Agent ${this.agent.vaultAddress} received event 'AgentDestroyed' with data ${formatArgs(event)}.`);
                    await this.handleAgentDestruction(em, event.args.agentVault);
                } else if (eventIs(event, this.context.ftsoManager, 'PriceEpochFinalized')) {
                    logger.info(`Agent ${this.agent.vaultAddress} received event 'PriceEpochFinalized' with data ${formatArgs(event)}.`);
                    await this.checkAgentForCollateralRatiosAndTopUp();
                } else if (eventIs(event, this.context.assetManager, 'AgentInCCB')) {
                    logger.info(`Agent ${this.agent.vaultAddress} received event 'AgentInCCB' with data ${formatArgs(event)}.`);
                    this.notifier.sendCCBAlert(event.args.agentVault, event.args.timestamp);
                } else if (eventIs(event, this.context.assetManager, 'LiquidationStarted')) {
                    logger.info(`Agent ${this.agent.vaultAddress} received event 'LiquidationStarted' with data ${formatArgs(event)}.`);
                    this.notifier.sendLiquidationStartAlert(event.args.agentVault, event.args.timestamp);
                } else if (eventIs(event, this.context.assetManager, 'LiquidationPerformed')) {
                    logger.info(`Agent ${this.agent.vaultAddress} received event 'LiquidationPerformed' with data ${formatArgs(event)}.`);
                    this.notifier.sendLiquidationWasPerformed(event.args.agentVault, event.args.valueUBA);
                } else if (eventIs(event, this.context.assetManager, "UnderlyingBalanceTooLow")) {
                    logger.info(`Agent ${this.agent.vaultAddress} received event 'UnderlyingBalanceTooLow' with data ${formatArgs(event)}.`);
                    this.notifier.sendFullLiquidationAlert(event.args.agentVault);
                } else if (eventIs(event, this.context.assetManager, "DuplicatePaymentConfirmed")) {
                    logger.info(`Agent ${this.agent.vaultAddress} received event 'DuplicatePaymentConfirmed' with data ${formatArgs(event)}.`);
                    this.notifier.sendFullLiquidationAlert(event.args.agentVault, event.args.transactionHash1, event.args.transactionHash2);
                } else if (eventIs(event, this.context.assetManager, "IllegalPaymentConfirmed")) {
                    logger.info(`Agent ${this.agent.vaultAddress} received event 'IllegalPaymentConfirmed' with data ${formatArgs(event)}.`);
                    this.notifier.sendFullLiquidationAlert(event.args.agentVault, event.args.transactionHash);
                }
            }
        }).catch(error => {
            console.error(`Error handling events for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Error handling events for agent ${this.agent.vaultAddress}  ${error}.`);
        });
    }

    /**
     * Checks is there are any new events from assetManager.
     */
    async readUnhandledEvents(em: EM): Promise<EvmEvent[]> {
        const agentEnt = await em.findOneOrFail(AgentEntity, { vaultAddress: this.agent.vaultAddress } as FilterQuery<AgentEntity>);
        logger.info(`Agent ${this.agent.vaultAddress} started reading unhandled events FROM block ${agentEnt.lastEventBlockHandled}`);
        // get all logs for this agent
        const nci = this.context.nativeChainInfo;
        const lastBlock = await web3.eth.getBlockNumber() - nci.finalizationBlocks;
        const events: EvmEvent[] = [];
        const encodedVaultAddress = web3.eth.abi.encodeParameter('address', this.agent.vaultAddress);
        for (let lastHandled = agentEnt.lastEventBlockHandled; lastHandled < lastBlock; lastHandled += nci.readLogsChunkSize) {
            const logsAssetManager = await web3.eth.getPastLogs({
                address: this.agent.assetManager.address,
                fromBlock: lastHandled + 1,
                toBlock: Math.min(lastHandled + nci.readLogsChunkSize, lastBlock),
                topics: [null, encodedVaultAddress]
            });
            events.push(...this.eventDecoder.decodeEvents(logsAssetManager));
            const logsFtsoManager = await web3.eth.getPastLogs({
                address: this.context.ftsoManager.address,
                fromBlock: lastHandled + 1,
                toBlock: Math.min(lastHandled + nci.readLogsChunkSize, lastBlock),
                topics: [null]
            });
            events.push(...this.eventDecoder.decodeEvents(logsFtsoManager));
        }
        // mark as handled
        events.sort((a, b) => a.blockNumber - b.blockNumber);
        agentEnt.lastEventBlockHandled = lastBlock;
        logger.info(`Agent ${this.agent.vaultAddress} started reading unhandled events TO block ${agentEnt.lastEventBlockHandled}`);
        return events;
    }

    /**
     * Once a day checks if any minting or redemption is stuck in corner case.
     */
    async handleCornerCases(rootEm: EM): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} started handling corner cases.`);
        const agentEnt = await rootEm.findOneOrFail(AgentEntity, { vaultAddress: this.agent.vaultAddress } as FilterQuery<AgentEntity>);
        const latestBlock = await latestUnderlyingBlock(this.context);
        if (latestBlock && ((toBN(latestBlock.timestamp).sub(toBN(agentEnt.cornerCaseCheckTimestamp))).ltn(1 * DAYS) || toBN(agentEnt.cornerCaseCheckTimestamp).eq(BN_ZERO))) {
            this.latestProof = await this.context.attestationProvider.proveConfirmedBlockHeightExists(await attestationWindowSeconds(this.context));
            await this.handleOpenMintings(rootEm);
            await this.handleOpenRedemptionsForCornerCase(rootEm);
            agentEnt.cornerCaseCheckTimestamp = toBN(latestBlock.timestamp);
            await rootEm.persistAndFlush(agentEnt);
        }
        logger.info(`Agent ${this.agent.vaultAddress} finished handling corner cases.`);
    }


    /**
     * Checks and handles if there are any AgentBot actions (withdraw, exit available list, update AgentBot setting) waited to be executed due to required announcement or time lock.
     */
    async handleAgentsWaitingsAndCleanUp(rootEm: EM): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} started handling 'handleAgentsWaitingsAndCleanUp'.`);
        await rootEm.transactional(async em => {
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
                    logger.info(`Agent ${this.agent.vaultAddress} cannot yet be destroyed. Allowed at ${agentEnt.waitingForDestructionTimestamp.toString()}. Current ${latestTimestamp.toString()}.`);
                }
            }
            if (toBN(agentEnt.withdrawalAllowedAtTimestamp).gt(BN_ZERO)) {
                logger.info(`Agent ${this.agent.vaultAddress} is waiting for vault collateral withdrawal.`);
                // agent waiting for class1 withdrawal
                if (toBN(agentEnt.withdrawalAllowedAtTimestamp).lte(latestTimestamp)) {
                    // agent can withdraw vault collateral
                    await this.agent.withdrawVaultCollateral(agentEnt.withdrawalAllowedAtAmount);
                    this.notifier.sendWithdrawVaultCollateral(agentEnt.vaultAddress, agentEnt.withdrawalAllowedAtAmount.toString());
                    logger.info(`Agent ${this.agent.vaultAddress} withdrew yet be withdraw ${agentEnt.withdrawalAllowedAtAmount.toString()}.`);
                    agentEnt.withdrawalAllowedAtTimestamp = BN_ZERO;
                    agentEnt.withdrawalAllowedAtAmount = "";
                } else {
                    logger.info(`Agent ${this.agent.vaultAddress} cannot yet be withdraw. Allowed at ${agentEnt.withdrawalAllowedAtTimestamp.toString()}. Current ${latestTimestamp.toString()}.`);
                }
            }
            if (toBN(agentEnt.agentSettingUpdateValidAtTimestamp).gt(BN_ZERO)) {
                logger.info(`Agent ${this.agent.vaultAddress} is waiting for agent settings update.`);
                // agent waiting for setting update
                if (toBN(agentEnt.agentSettingUpdateValidAtTimestamp).lte(latestTimestamp)) {
                    // agent can update setting
                    await this.agent.executeAgentSettingUpdate(agentEnt.agentSettingUpdateValidAtName);
                    this.notifier.sendAgentSettingsUpdate(agentEnt.vaultAddress, agentEnt.agentSettingUpdateValidAtName);
                    logger.info(`Agent ${this.agent.vaultAddress} updated agent setting ${agentEnt.agentSettingUpdateValidAtName}.`);
                    agentEnt.agentSettingUpdateValidAtTimestamp = BN_ZERO;
                    agentEnt.agentSettingUpdateValidAtName = "";
                } else {
                    logger.info(`Agent ${this.agent.vaultAddress} cannot yet be update agent setting. Allowed at ${agentEnt.agentSettingUpdateValidAtName.toString()}. Current ${latestTimestamp.toString()}.`);
                }
            }
            if (toBN(agentEnt.exitAvailableAllowedAtTimestamp).gt(BN_ZERO) && agentEnt.waitingForDestructionCleanUp) {
                // agent can exit available and is agent waiting for clean up before destruction
                await this.exitAvailable(agentEnt);
            } else if (toBN(agentEnt.exitAvailableAllowedAtTimestamp).gt(BN_ZERO)) {
                // agent can exit available
                await this.exitAvailable(agentEnt);
            } else if (agentEnt.waitingForDestructionCleanUp && (toBN(agentEnt.destroyClass1WithdrawalAllowedAtTimestamp).gt(BN_ZERO) || toBN(agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp).gt(BN_ZERO))) {
                logger.info(`Agent ${this.agent.vaultAddress} is waiting for clean up before destruction and for class1 withdrawal.`);
                // agent waiting to withdraw class1 or to redeem pool tokens
                if (toBN(agentEnt.destroyClass1WithdrawalAllowedAtTimestamp).gt(BN_ZERO) && toBN(agentEnt.destroyClass1WithdrawalAllowedAtTimestamp).lte(latestTimestamp)) {
                    // agent can withdraw class1
                    await this.agent.withdrawClass1Collateral(agentEnt.destroyClass1WithdrawalAllowedAtAmount);
                    this.notifier.sendWithdrawClass1(agentEnt.vaultAddress, agentEnt.destroyClass1WithdrawalAllowedAtAmount.toString());
                    logger.info(`Agent ${this.agent.vaultAddress} withdrew yet be withdraw ${agentEnt.destroyClass1WithdrawalAllowedAtAmount.toString()}.`);
                    agentEnt.destroyClass1WithdrawalAllowedAtAmount = "";
                    agentEnt.destroyClass1WithdrawalAllowedAtTimestamp = BN_ZERO;
                } else {
                    logger.info(`Agent ${this.agent.vaultAddress} cannot yet be withdraw. Allowed at ${agentEnt.withdrawalAllowedAtTimestamp.toString()}. Current ${latestTimestamp.toString()}.`);
                }
                // agent waiting to redeem pool tokens
                if (toBN(agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp).gt(BN_ZERO) && toBN(agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp).lte(latestTimestamp)) {
                    logger.info(`Agent ${this.agent.vaultAddress} is waiting for clean up before destruction and for pool token redemption.`);
                    // agent can redeem pool tokens
                    await this.agent.redeemContingencyPoolTokens(agentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount);
                    logger.info(`Agent ${this.agent.vaultAddress} redeemed pool tokens ${agentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount.toString()}.`);
                    agentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount = "";
                    agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp = BN_ZERO;
                    this.notifier.sendContingencyPoolTokensRedemption(agentEnt.vaultAddress);
                }
            } else if (agentEnt.waitingForDestructionCleanUp) {
                logger.info(`Agent ${this.agent.vaultAddress} is checking if clean up before destruction is complete.`);
                // agent checks if clean up is complete
                // withdraw pool fees
                const poolFeeBalance = await this.agent.poolFeeBalance();
                if (poolFeeBalance.gt(BN_ZERO)) {
                    await this.agent.withdrawPoolFees(poolFeeBalance);
                    logger.info(`Agent ${this.agent.vaultAddress} withdrew pool fees ${poolFeeBalance.toString()}.`);
                }
                // check poolTokens and vaultCollateralBalance
                const agentInfoForAnnounce = await this.agent.getAgentInfo();
                const freeVaultCollateralBalance = toBN(agentInfoForAnnounce.freeVaultCollateralWei);
                const freePoolTokenBalance = toBN(agentInfoForAnnounce.freePoolCollateralNATWei);
                if (freeVaultCollateralBalance.gt(BN_ZERO)) {
                    // announce withdraw class 1
                    agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp = await this.agent.announceVaultCollateralWithdrawal(freeVaultCollateralBalance);
                    agentEnt.destroyVaultCollateralWithdrawalAllowedAtAmount = freeVaultCollateralBalance.toString();
                    logger.info(`Agent ${this.agent.vaultAddress} announced class1 withdraw of ${freeClass1Balance.toString()} at ${agentEnt.destroyClass1WithdrawalAllowedAtTimestamp}.`);
                }
                if (freePoolTokenBalance.gt(BN_ZERO)) {
                    // announce redeem pool tokens and wait for others to do so (pool needs to be empty)
                    agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp = await this.agent.announcePoolTokenRedemption(freePoolTokenBalance);
                    agentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount = freePoolTokenBalance.toString();
                    logger.info(`Agent ${this.agent.vaultAddress} announced pool token redemption of ${freePoolTokenBalance.toString()} at ${agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp}.`);
                }
                const agentInfoForDestroy = await this.agent.getAgentInfo();
                //and wait for others to redeem
                if (freePoolTokenBalance.eq(BN_ZERO) && freeVaultCollateralBalance.eq(BN_ZERO) && toBN(agentInfoForDestroy.mintedUBA).eq(BN_ZERO) && toBN(agentInfoForDestroy.redeemingUBA).eq(BN_ZERO) && toBN(agentInfoForDestroy.reservedUBA).eq(BN_ZERO) && toBN(agentInfoForDestroy.poolRedeemingUBA).eq(BN_ZERO)) {
                    // agent checks if clean is complete, agent can announce destroy
                    const destroyAllowedAt = await this.agent.announceDestroy();
                    agentEnt.waitingForDestructionTimestamp = destroyAllowedAt;
                    agentEnt.waitingForDestructionCleanUp = false;
                    this.notifier.sendAgentAnnounceDestroy(agentEnt.vaultAddress);
                    logger.info(`Agent ${this.agent.vaultAddress} was destroyed.`);
                }
            }
            // confirm underlying withdrawal
            if (toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).gt(BN_ZERO)) {
                logger.info(`Agent ${this.agent.vaultAddress} is waiting for confirming underlying withdrawal.`);
                // agent waiting for underlying withdrawal
                if (agentEnt.underlyingWithdrawalConfirmTransaction.length) {
                    const announcedUnderlyingConfirmationMinSeconds = toBN((await this.context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds);
                    if ((agentEnt.underlyingWithdrawalAnnouncedAtTimestamp.add(announcedUnderlyingConfirmationMinSeconds)).lt(latestTimestamp)) {
                        // agent can confirm underlying withdrawal
                        await this.agent.confirmUnderlyingWithdrawal(agentEnt.underlyingWithdrawalConfirmTransaction);
                        this.notifier.sendConfirmWithdrawUnderlying(agentEnt.vaultAddress);
                        logger.info(`Agent ${this.agent.vaultAddress} confirmed underlying withdrawal of tx ${agentEnt.underlyingWithdrawalConfirmTransaction}.`);
                        agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = BN_ZERO;
                        agentEnt.underlyingWithdrawalConfirmTransaction = "";
                    } else {
                        logger.info(`Agent ${this.agent.vaultAddress} cannot yet confirm underlying withdrawal. Allowed at ${agentEnt.underlyingWithdrawalAnnouncedAtTimestamp.add(announcedUnderlyingConfirmationMinSeconds).toString()}. Current ${latestTimestamp.toString()}.`);
                    }
                }
            }
            // cancel underlying withdrawal
            if (agentEnt.underlyingWithdrawalWaitingForCancelation) {
                logger.info(`Agent ${this.agent.vaultAddress} is waiting for canceling underlying withdrawal.`);
                const announcedUnderlyingConfirmationMinSeconds = toBN((await this.context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds);
                if ((toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).add(announcedUnderlyingConfirmationMinSeconds)).lt(latestTimestamp)) {
                    // agent can confirm cancel withdrawal announcement
                    await this.agent.cancelUnderlyingWithdrawal();
                    this.notifier.sendCancelWithdrawUnderlying(agentEnt.vaultAddress);
                    logger.info(`Agent ${this.agent.vaultAddress} canceled underlying withdrawal of tx ${agentEnt.underlyingWithdrawalConfirmTransaction}.`);
                    agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = BN_ZERO;
                    agentEnt.underlyingWithdrawalConfirmTransaction = "";
                    agentEnt.underlyingWithdrawalWaitingForCancelation = false;
                } else {
                    logger.info(`Agent ${this.agent.vaultAddress} cannot yet cancel underlying withdrawal. Allowed at ${agentEnt.underlyingWithdrawalAnnouncedAtTimestamp.toString()}. Current ${latestTimestamp.toString()}.`);
                }
            }
            em.persist(agentEnt);
        });
        logger.info(`Agent ${this.agent.vaultAddress} finished handling 'handleAgentsWaitingsAndCleanUp'.`);
    }

    /**
     * AgentBot exits available if already allowed
     */
    async exitAvailable(agentEnt: AgentEntity) {
        logger.info(`Agent ${this.agent.vaultAddress} is waiting to exit available.`);
        const latestTimestamp = await latestBlockTimestampBN();
        if (toBN(agentEnt.exitAvailableAllowedAtTimestamp).lte(latestTimestamp)) {
            await this.agent.exitAvailable();
            agentEnt.exitAvailableAllowedAtTimestamp = BN_ZERO;
            this.notifier.sendAgentExitedAvailable(agentEnt.vaultAddress);
            logger.info(`Agent ${this.agent.vaultAddress} exited available.`);
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} cannot yet be exit available. Allowed at ${agentEnt.exitAvailableAllowedAtTimestamp.toString()}. Current ${latestTimestamp.toString()}.`);
        }
    }

    /**
     * Stores received collateral reservation as minting in persistent state.
     */
    mintingStarted(em: EM, request: EventArgs<CollateralReserved>): void {
        em.create(AgentMinting, {
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
        } as RequiredEntityData<AgentMinting>, { persist: true });
        this.notifier.sendMintingStared(this.agent.vaultAddress, request.collateralReservationId.toString());
        logger.info(`Agent ${this.agent.vaultAddress} started minting ${request.collateralReservationId.toString()}.`);
    }

    /**
     * Returns minting by required id from persistent state.
     */
    async findMinting(em: EM, requestId: BN): Promise<AgentMinting> {
        const agentAddress = this.agent.vaultAddress;
        return await em.findOneOrFail(AgentMinting, { agentAddress, requestId } as FilterQuery<AgentMinting>);
    }

    async handleOpenMintings(rootEm: EM): Promise<void> {
        const openMintings = await this.openMintings(rootEm, true);
        logger.info(`Agent ${this.agent.vaultAddress} started handling open mintings ${openMintings.length}.`);
        for (const rd of openMintings) {
            await this.nextMintingStep(rootEm, rd.id);
        }
        logger.info(`Agent ${this.agent.vaultAddress} finished handling open mintings.`);
    }

    /**
     * Returns minting with state other than DONE.
     */
    async openMintings(em: EM, onlyIds: boolean): Promise<AgentMinting[]> {
        let query = em.createQueryBuilder(AgentMinting);
        if (onlyIds) query = query.select('id');
        return await query.where({ agentAddress: this.agent.vaultAddress })
            .andWhere({ $not: { state: AgentMintingState.DONE } })
            .getResultList();
    }

    /**
     * Marks stored minting in persistent state as DONE.
     */
    mintingExecuted(minting: AgentMinting, executed: boolean): void {
        minting.state = AgentMintingState.DONE;
        if (executed) {
            this.notifier.sendMintingExecuted(minting.agentAddress, minting.requestId.toString());
            logger.info(`Agent ${this.agent.vaultAddress} executed mintings with crId ${minting.requestId}.`);
        } else {
            this.notifier.sendMintingDeleted(minting.agentAddress, minting.requestId.toString());
            logger.info(`Agent ${this.agent.vaultAddress} deleted mintings with crId ${minting.requestId}.`);
        }
    }

    /**
     * Handles mintings stored in persistent state according to their state.
     */
    async nextMintingStep(rootEm: EM, id: number): Promise<void> {
        await rootEm.transactional(async em => {
            const minting = await em.getRepository(AgentMinting).findOneOrFail({ id: Number(id) } as FilterQuery<AgentMinting>);
            logger.info(`Agent ${this.agent.vaultAddress} is handling open mintings with crId ${minting.requestId} and state ${minting.state}.`);
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
                    logger.error(`Redemption state: ${minting.state} not supported for crId ${minting.requestId.toString()}.`);
            }
        }).catch((error) => {
            console.error(`Error handling next minting step for minting ${id} agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Error handling next minting step for minting ${id} agent ${this.agent.vaultAddress}: ${error}.`);
        });
    }

    /**
     * When minting is in state STARTED, it checks if underlying payment proof for collateral reservation expired in indexer.
     * If proof expired (corner case), it calls unstickMinting, sets the state of minting in persistent state as DONE and send notification to owner.
     * If proof exists, it checks if time for payment expired on underlying. If if did not expire, then it does nothing.
     * If time for payment expired, it checks via indexer if transaction for payment exists.
     * If it does exists, then it requests for payment proof - see requestPaymentProofForMinting().
     * If it does not exist, then it request non payment proof - see requestNonPaymentProofForMinting().
     */
    async checkForNonPaymentProofOrExpiredProofs(minting: AgentMinting): Promise<void> {
        const proof = await this.checkProofExpiredInIndexer(toBN(minting.lastUnderlyingBlock), toBN(minting.lastUnderlyingTimestamp))
        if (proof) {
            // corner case: proof expires in indexer
            const settings = await this.context.assetManager.getSettings();
            const burnNats = toBN((await this.agent.getPoolCollateralPrice()).convertUBAToTokenWei(toBN(minting.valueUBA)).mul(toBN(settings.vaultCollateralBuyForFlareFactorBIPS)).divn(MAX_BIPS));
            await this.context.assetManager.unstickMinting(web3DeepNormalize(proof), toBN(minting.requestId), { from: this.agent.ownerAddress, value: burnNats });
            minting.state = AgentMintingState.DONE;
            this.notifier.sendMintingCornerCase(minting.requestId.toString(), true, false);
            logger.info(`Agent ${this.agent.vaultAddress} unsticked minting for minting with crtId ${minting.requestId} with proof ${JSON.stringify(web3DeepNormalize(proof))}.`);
        } else {
            // proof did not expire
            const blockHeight = await this.context.blockchainIndexer.getBlockHeight();
            const latestBlock = await this.context.blockchainIndexer.getBlockAt(blockHeight);
            // wait times expires on underlying + finalizationBlock
            if (latestBlock && Number(minting.lastUnderlyingBlock) + 1 + this.context.blockchainIndexer.finalizationBlocks < latestBlock.number) {
                // time for payment expired on underlying
                const txs = await this.agent.context.blockchainIndexer.getTransactionsByReference(minting.paymentReference, true);
                /* istanbul ignore else */
                if (txs.length === 1) {
                    // corner case: minter pays and doesn't execute minting
                    // check minter paid -> request payment proof -> execute minting
                    const txHash = txs[0].hash;
                    // TODO is it ok to check first address in UTXO chains?
                    const sourceAddress = txs[0].inputs[0][0];
                    await this.requestPaymentProofForMinting(minting, txHash, sourceAddress);
                } else if (txs.length === 0) {
                    // minter did not pay -> request non payment proof -> unstick minting
                    await this.requestNonPaymentProofForMinting(minting);
                }
            }
        }
    }

    /**
     * Sends request for minting payment proof, sets state for minting in persistent state to REQUEST_PAYMENT_PROOF and sends notification to owner,
     */
    async requestPaymentProofForMinting(minting: AgentMinting, txHash: string, sourceAddress: string): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is sending request for payment proof for minting with crId ${minting.requestId.toString()}.`);
        const request = await this.context.attestationProvider.requestPaymentProof(txHash, sourceAddress, this.agent.underlyingAddress);
        if (request) {
            minting.state = AgentMintingState.REQUEST_PAYMENT_PROOF;
            minting.proofRequestRound = request.round;
            minting.proofRequestData = request.data;
            this.notifier.sendMintingCornerCase(minting.requestId.toString(), false, true);
            logger.info(`Agent ${this.agent.vaultAddress} requested payment proof for minting with crId ${minting.requestId}, txHash ${txHash}, source underlying address ${sourceAddress}, proofRequestRound ${request.round}, proofRequestData ${request.data}`);
        } else {// else cannot prove request yet
            logger.info(`Cannot yet prove payment proof for minting with crId ${minting.requestId.toString()}.`);
    }
    }

    /**
     * Sends request for minting non payment proof, sets state for minting in persistent state to REQUEST_NON_PAYMENT_PROOF and sends notification to owner,
     */
    async requestNonPaymentProofForMinting(minting: AgentMinting): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is sending request for non payment proof for minting with crId ${minting.requestId.toString()}.`);
        const request = await this.context.attestationProvider.requestReferencedPaymentNonexistenceProof(
            minting.agentUnderlyingAddress,
            minting.paymentReference,
            toBN(minting.valueUBA).add(toBN(minting.feeUBA)),
            Number(minting.firstUnderlyingBlock),
            Number(minting.lastUnderlyingBlock),
            Number(minting.lastUnderlyingTimestamp));
        if (request) {
            minting.state = AgentMintingState.REQUEST_NON_PAYMENT_PROOF;
            minting.proofRequestRound = request.round;
            minting.proofRequestData = request.data;
            this.notifier.sendMintingCornerCase(minting.requestId.toString(), false, false);
            logger.info(`Agent ${this.agent.vaultAddress} requested non payment proof for minting with crId ${minting.requestId}, reference ${minting.paymentReference}, target underlying address ${minting.agentUnderlyingAddress}, proofRequestRound ${request.round}, proofRequestData ${request.data}`);
        } else {// else cannot prove request yet
            logger.info(`Cannot yet prove non payment proof for redemption with crId ${minting.requestId.toString()}.`);
    }
    }

    /**
     * When minting is in state REQUEST_NON_PAYMENT_PROOF, it obtains non payment proof, calls mintingPaymentDefault and sets minting in persistent state to DONE.
     * If proof cannot be obtained, it sends notification to owner.
     */
    async checkNonPayment(minting: AgentMinting): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is trying to obtain NON payment proof minting with crId ${minting.requestId} with proofRequestRound ${minting.proofRequestRound} and proofRequestData ${minting.proofRequestData}.`);
        const proof = await this.context.attestationProvider.obtainReferencedPaymentNonexistenceProof(minting.proofRequestRound!, minting.proofRequestData!);
        if (!proof.finalized) {
            logger.info(`Proof not yet finalized for minting with crId ${minting.requestId} with proofRequestRound ${minting.proofRequestRound} and proofRequestData ${minting.proofRequestData}.`);
            return;
        }
        if (proof.result && proof.result.merkleProof) {
            const nonPaymentProof = proof.result as ProvedDH<DHReferencedPaymentNonexistence>;
            await this.context.assetManager.mintingPaymentDefault(web3DeepNormalize(nonPaymentProof), minting.requestId, { from: this.agent.ownerAddress });
            minting.state = AgentMintingState.DONE;
            this.mintingExecuted(minting, true);
            logger.info(`Agent ${this.agent.vaultAddress} executed minting payment default for minting with crtId ${minting.requestId} with proof ${JSON.stringify(web3DeepNormalize(nonPaymentProof))}.`);
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} cannot obtain NON payment proof for minting with crtId ${minting.requestId} with with proofRequestRound ${minting.proofRequestRound} and proofRequestData ${minting.proofRequestData}.`);
            this.notifier.sendNoProofObtained(minting.agentAddress, minting.requestId.toString(), minting.proofRequestRound!, minting.proofRequestData!);
        }
    }

    /**
     * When minting is in state REQUEST_PAYMENT_PROOF, it obtains payment proof, calls executeMinting and sets minting in persistent state to DONE.
     * If proof cannot be obtained, it sends notification to owner.
     */
    async checkPaymentAndExecuteMinting(minting: AgentMinting): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is trying to obtain payment proof minting with crId ${minting.requestId} with proofRequestRound ${minting.proofRequestRound} and proofRequestData ${minting.proofRequestData}.`);
        const proof = await this.context.attestationProvider.obtainPaymentProof(minting.proofRequestRound!, minting.proofRequestData!);
        if (!proof.finalized) {
            logger.info(`Proof not yet finalized for minting with crId ${minting.requestId} with proofRequestRound ${minting.proofRequestRound} and proofRequestData ${minting.proofRequestData}.`);
            return;
        }
        if (proof.result && proof.result.merkleProof) {
            const paymentProof = proof.result as ProvedDH<DHPayment>;
            await this.context.assetManager.executeMinting(web3DeepNormalize(paymentProof), minting.requestId, { from: this.agent.ownerAddress });
            minting.state = AgentMintingState.DONE;
            logger.info(`Agent ${this.agent.vaultAddress} executed minting for minting with crtId ${minting.requestId} with proof ${JSON.stringify(web3DeepNormalize(paymentProof))}.`);
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} cannot obtain payment proof for minting with crtId ${minting.requestId} with with proofRequestRound ${minting.proofRequestRound} and proofRequestData ${minting.proofRequestData}.`);
            this.notifier.sendNoProofObtained(minting.agentAddress, minting.requestId.toString(), minting.proofRequestRound!, minting.proofRequestData!);
        }
    }

    /**
     * Stores received redemption request as redemption in persistent state.
     */
    redemptionStarted(em: EM, request: EventArgs<RedemptionRequested>): void {
        em.create(AgentRedemption, {
            state: AgentRedemptionState.STARTED,
            agentAddress: this.agent.vaultAddress,
            requestId: toBN(request.requestId),
            paymentAddress: request.paymentAddress,
            valueUBA: toBN(request.valueUBA),
            feeUBA: toBN(request.feeUBA),
            paymentReference: request.paymentReference,
            lastUnderlyingBlock: toBN(request.lastUnderlyingBlock),
            lastUnderlyingTimestamp: toBN(request.lastUnderlyingTimestamp)
        } as RequiredEntityData<AgentRedemption>, { persist: true });
        this.notifier.sendRedemptionStarted(this.agent.vaultAddress, request.requestId.toString());
        logger.info(`Agent ${this.agent.vaultAddress} started redemption ${request.requestId.toString()}.`);
    }

    /**
     * Marks stored redemption in persistent state as DONE, then it checks AgentBot's and owner's underlying balance.
     */
    async redemptionFinished(em: EM, requestId: BN, agentVault: string): Promise<void> {
        const redemption = await this.findRedemption(em, requestId);
        redemption.state = AgentRedemptionState.DONE;
        logger.info(`Agent ${this.agent.vaultAddress} finished redemption ${requestId.toString()}.`);
        await this.checkUnderlyingBalance(agentVault);
    }

    /**
     * Returns redemption by required id from persistent state.
     */
    async findRedemption(em: EM, requestId: BN): Promise<AgentRedemption> {
        const agentAddress = this.agent.vaultAddress;
        return await em.findOneOrFail(AgentRedemption, { agentAddress, requestId } as FilterQuery<AgentRedemption>);
    }

    async handleOpenRedemptions(rootEm: EM): Promise<void> {
        const openRedemptions = await this.openRedemptions(rootEm, true);
        logger.info(`Agent ${this.agent.vaultAddress} started handling open redemptions ${openRedemptions.length}.`);
        for (const rd of openRedemptions) {
            await this.nextRedemptionStep(rootEm, rd.id);
        }
        logger.info(`Agent ${this.agent.vaultAddress} finished handling open redemptions.`);
    }

    async handleOpenRedemptionsForCornerCase(rootEm: EM): Promise<void> {
        const openRedemptions = await this.openRedemptions(rootEm, false);
        logger.info(`Agent ${this.agent.vaultAddress} started handling open redemptions ${openRedemptions.length} for CORNER CASE.`);
        for (const rd of openRedemptions) {
            const proof =  await this.checkProofExpiredInIndexer(toBN(rd.lastUnderlyingBlock), toBN(rd.lastUnderlyingTimestamp));
            if (proof) {
                logger.info(`Agent ${this.agent.vaultAddress} found corner case for redemption ${rd.requestId} and is calling 'finishRedemptionWithoutPayment'.`);
                // corner case - agent did not pay
                await this.context.assetManager.finishRedemptionWithoutPayment(web3DeepNormalize(proof), rd.requestId, { from: this.agent.ownerAddress });
                rd.state = AgentRedemptionState.DONE;
                this.notifier.sendRedemptionCornerCase(rd.requestId.toString(), rd.agentAddress);
                await rootEm.persistAndFlush(rd);
            }
        }
        logger.info(`Agent ${this.agent.vaultAddress} finished handling open redemptions for CORNER CASE.`);
    }

    /**
     * Returns minting with state other than DONE.
     */
    async openRedemptions(em: EM, onlyIds: boolean): Promise<AgentRedemption[]> {
        let query = em.createQueryBuilder(AgentRedemption);
        if (onlyIds) query = query.select('id');
        return await query.where({ agentAddress: this.agent.vaultAddress })
            .andWhere({ $not: { state: AgentRedemptionState.DONE } })
            .getResultList();
    }

    /**
     * Handles redemptions stored in persistent state according to their state.
     */
    async nextRedemptionStep(rootEm: EM, id: number): Promise<void> {
        await rootEm.transactional(async em => {
            const redemption = await em.getRepository(AgentRedemption).findOneOrFail({ id: Number(id) } as FilterQuery<AgentRedemption>);
            logger.info(`Agent ${this.agent.vaultAddress} is handling open redemption with requestId ${redemption.requestId} and state ${redemption.state}.`);
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
                    logger.error(`Redemption state: ${redemption.state} not supported for requestId ${redemption.requestId.toString()}.`);
            }
        }).catch((error) => {
            console.error(`Error handling next redemption step for redemption ${id} agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Error handling next redemption step for redemption ${id} agent ${this.agent.vaultAddress}: ${error}.`);
        });
    }

    /**
     * When redemption is in state STARTED, it checks if payment can be done in time.
     * Then it performs payment and sets the state of redemption in persistent state as PAID.
     */
    async payForRedemption(redemption: AgentRedemption): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is trying to pay for redemption with requestId ${redemption.requestId.toString()}.`);
        const blockHeight = await this.context.blockchainIndexer.getBlockHeight();
        const lastBlock = await this.context.blockchainIndexer.getBlockAt(blockHeight);
        if (lastBlock && (toBN(lastBlock.number).lt(toBN(redemption.lastUnderlyingBlock)) || toBN(lastBlock.timestamp).lt(toBN(redemption.lastUnderlyingTimestamp)))) {
            // pay
            const paymentAmount = toBN(redemption.valueUBA).sub(toBN(redemption.feeUBA));
            // !!! TODO: what if there are too little funds on underlying address to pay for fee?
            const txHash = await this.agent.performPayment(redemption.paymentAddress, paymentAmount, redemption.paymentReference);
            redemption.txHash = txHash;
            redemption.state = AgentRedemptionState.PAID;
            this.notifier.sendRedemptionPaid(this.agent.vaultAddress, redemption.requestId.toString());
            logger.info(`Agent ${this.agent.vaultAddress} paid for redemption with requestId ${redemption.requestId}, txHash ${txHash}, target underlying address ${redemption.paymentAddress}, payment reference ${redemption.paymentReference}, amount ${paymentAmount.toString()}.`);
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} DID NOT pay for redemption with requestId ${redemption.requestId}. Time expired on underlying chain. Last block for payment was ${redemption.lastUnderlyingBlock.toString()} with timestamp ${redemption.lastUnderlyingTimestamp.toString()}. Current block is ${lastBlock?.number} with timestamp ${lastBlock?.timestamp}.`);
        }
    }

    /**
     * When redemption is in state PAID it requests payment proof - see requestPaymentProof().
     */
    async checkPaymentProofAvailable(redemption: AgentRedemption): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is checking if payment proof for redemption with requestId ${redemption.requestId} is available.`);
        const txBlock = await this.context.blockchainIndexer.getTransactionBlock(redemption.txHash!);
        const blockHeight = await this.context.blockchainIndexer.getBlockHeight();
        if (txBlock != null && blockHeight - txBlock.number >= this.context.blockchainIndexer.finalizationBlocks) {
            await this.requestPaymentProof(redemption);
            this.notifier.sendRedemptionRequestPaymentProof(this.agent.vaultAddress, redemption.requestId.toString());
        }
    }

    /**
     * Sends request for redemption payment proof, sets state for redemption in persistent state to REQUESTED_PROOF.
     */
    async requestPaymentProof(redemption: AgentRedemption): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is sending request for payment proof for redemption with requestId ${redemption.requestId.toString()}.`);
        const request = await this.context.attestationProvider.requestPaymentProof(redemption.txHash!, this.agent.underlyingAddress, redemption.paymentAddress);
        if (request) {
            redemption.state = AgentRedemptionState.REQUESTED_PROOF;
            redemption.proofRequestRound = request.round;
            redemption.proofRequestData = request.data;
            logger.info(`Agent ${this.agent.vaultAddress} requested payment proof for redemption with requestId ${redemption.requestId}, txHash ${redemption.txHash}, target underlying address ${redemption.paymentAddress}, proofRequestRound ${request.round}, proofRequestData ${request.data}`);
        } else {// else cannot prove request yet
            logger.info(`Cannot yet prove payment proof for redemption with requestId ${redemption.requestId.toString()}.`);
    }
    }

    /**
     * When redemption is in state REQUESTED_PROOF, it obtains payment proof, calls confirmRedemptionPayment and sets the state of redemption in persistent state as DONE.
     * If proof expired (corner case), it calls finishRedemptionWithoutPayment, sets the state of redemption in persistent state as DONE and send notification to owner.
     * If proof cannot be obtained, it sends notification to owner.
     */
    async checkConfirmPayment(redemption: AgentRedemption): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is trying to obtain payment proof redemption with requestId ${redemption.requestId} with proofRequestRound ${redemption.proofRequestRound} and proofRequestData ${redemption.proofRequestData}.`);
        const proof = await this.context.attestationProvider.obtainPaymentProof(redemption.proofRequestRound!, redemption.proofRequestData!);
        if (!proof.finalized) {
            logger.info(`Proof not yet finalized for redemption with requestId ${redemption.requestId} with proofRequestRound ${redemption.proofRequestRound} and proofRequestData ${redemption.proofRequestData}.`);
            return;
        }
        if (proof.result && proof.result.merkleProof) {
            const paymentProof = proof.result as ProvedDH<DHPayment>;
            await this.context.assetManager.confirmRedemptionPayment(web3DeepNormalize(paymentProof), redemption.requestId, { from: this.agent.ownerAddress });
            redemption.state = AgentRedemptionState.DONE;
            logger.info(`Agent ${this.agent.vaultAddress} confirmed redemption payment for redemption with requestId ${redemption.requestId} with proof ${JSON.stringify(web3DeepNormalize(paymentProof))}.`);
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} cannot obtain payment proof for redemption with requestId ${redemption.requestId} with with proofRequestRound ${redemption.proofRequestRound} and proofRequestData ${redemption.proofRequestData}.`);
            this.notifier.sendNoProofObtained(redemption.agentAddress, redemption.requestId.toString(), redemption.proofRequestRound!, redemption.proofRequestData!, true);
        }
    }

    /**
     * Checks if proof has expired in indexer.
     */
    async checkProofExpiredInIndexer(lastUnderlyingBlock: BN, lastUnderlyingTimestamp: BN): Promise<ProvedDH<DHConfirmedBlockHeightExists> | null> {
        logger.info(`Agent ${this.agent.vaultAddress} is trying to checking if transactions (proofs) can still be obtained from indexer.`);
        const proof = this.latestProof;
        if (proof) {
            const lqwBlock = toBN(proof.lowestQueryWindowBlockNumber);
            const lqwBTimestamp = toBN(proof.lowestQueryWindowBlockTimestamp);
            if (lqwBlock.gt(lastUnderlyingBlock) && lqwBTimestamp.gt(lastUnderlyingTimestamp)) {
                logger.info(`Agent ${this.agent.vaultAddress} confirmed that transactions (proofs) CANNOT be obtained from indexer.`);
                return proof;
            }
        }
        logger.info(`Agent ${this.agent.vaultAddress} confirmed that transactions (proofs) CAN be obtained from indexer.`);
        return null;
    }

    /**
     * Marks stored AgentBot in persistent state as inactive after event 'AgentDestroyed' is received.
     */
    async handleAgentDestruction(em: EM, vaultAddress: string): Promise<void> {
        const agentBotEnt = await em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress } as FilterQuery<AgentEntity>);
        agentBotEnt.active = false;
        this.notifier.sendAgentDestroyed(vaultAddress);
        logger.info(`Agent ${this.agent.vaultAddress} was destroyed.`);
    }

    /**
     * Checks AgentBot's and owner's underlying balance after redemption is finished. If AgentBot's balance is too low, it tries to top it up from owner's account. See 'underlyingTopUp(...)'.
     */
    async checkUnderlyingBalance(agentVault: string): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is checking underlying balance.`);
        const freeUnderlyingBalance = toBN((await this.agent.getAgentInfo()).freeUnderlyingBalanceUBA);
        const estimatedFee = toBN(await this.context.wallet.getTransactionFee());
        if (freeUnderlyingBalance.lte(estimatedFee.muln(NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR))) {
            await this.underlyingTopUp(estimatedFee.muln(NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR), agentVault, freeUnderlyingBalance);
        } else {
            logger.info(`Underlying top up is not needed for agent ${this.agent.vaultAddress}.`);
        }
    }

    /**
     * Tries to top up AgentBot's underlying account from owner's. It notifies about successful and unsuccessful try.
     * It also checks owner's underlying balance and notifies when it is too low.
     */
    async underlyingTopUp(amount: BN, agentVault: string, freeUnderlyingBalance: BN): Promise<void> {
        const ownerUnderlyingAddress = requireEnv('OWNER_UNDERLYING_ADDRESS');
        try {
            logger.info(`Agent ${this.agent.vaultAddress} is trying to top up underlying from owner's underlying address ${ownerUnderlyingAddress}.`);
            const txHash = await this.agent.performTopupPayment(amount, ownerUnderlyingAddress);
            await this.agent.confirmTopupPayment(txHash);
            this.notifier.sendLowUnderlyingAgentBalance(agentVault, amount.toString());
            logger.info(`Agent ${this.agent.vaultAddress} topped up underlying with amount ${amount.toString()} from owner's underlying address ${ownerUnderlyingAddress} with txHash ${txHash}.`);
        } catch (error) {
            this.notifier.sendLowUnderlyingAgentBalanceFailed(agentVault, freeUnderlyingBalance.toString());
            logger.error(`Agent ${this.agent.vaultAddress} has low freeUnderlyingBalance ${freeUnderlyingBalance.toString()} and could not be from owner's underlying address ${ownerUnderlyingAddress}.`);
        }
        const ownerUnderlyingBalance = await this.context.wallet.getBalance(ownerUnderlyingAddress);
        const estimatedFee = toBN(await this.context.wallet.getTransactionFee());
        if (ownerUnderlyingBalance.lte(estimatedFee.muln(NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR))) {
            this.notifier.sendLowBalanceOnUnderlyingOwnersAddress(ownerUnderlyingAddress, ownerUnderlyingBalance.toString());
            logger.info(`Owner ${this.agent.ownerAddress} has low balance of ${ownerUnderlyingBalance.toString()} on underlying address ${ownerUnderlyingAddress}.`);
        } else {
            logger.info(`Owner ${this.agent.ownerAddress} has ${ownerUnderlyingBalance.toString()} on underlying address ${ownerUnderlyingAddress}.`);
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
                logger.info(`Agent ${this.agent.vaultAddress} is trying to top up class1 collateral from owner ${this.agent.ownerAddress}.`);
                await this.agent.depositClass1Collateral(requiredTopUpClass1);
                this.notifier.sendCollateralTopUpAlert(this.agent.vaultAddress, requiredTopUpClass1.toString());
                logger.info(`Agent ${this.agent.vaultAddress} topped up class1 with amount ${requiredTopUpClass1.toString()} from owner ${this.agent.ownerAddress}.`);
            } catch (err) {
                this.notifier.sendCollateralTopUpFailedAlert(this.agent.vaultAddress, requiredTopUpVaultCollateral.toString());
                logger.error(`Agent ${this.agent.vaultAddress} could NOT be topped up with class1 ${requiredTopUpClass1.toString()} from owner ${this.agent.ownerAddress}.`);
            }
        }
        if (requiredTopUpPool.gt(BN_ZERO)) {
            try {
                logger.info(`Agent ${this.agent.vaultAddress} is trying to buy collateral pool tokens from owner ${this.agent.ownerAddress}.`);
                await this.agent.buyCollateralPoolTokens(requiredTopUpPool);
                this.notifier.sendCollateralTopUpAlert(this.agent.vaultAddress, requiredTopUpPool.toString(), true);
                logger.info(`Agent ${this.agent.vaultAddress} bought collateral pool tokens ${requiredTopUpPool.toString()} from owner ${this.agent.ownerAddress}.`);
            } catch (err) {
                this.notifier.sendCollateralTopUpFailedAlert(this.agent.vaultAddress, requiredTopUpPool.toString(), true);
                logger.error(`Agent ${this.agent.vaultAddress} could NOT buy collateral pool tokens ${requiredTopUpClass1.toString()} from owner ${this.agent.ownerAddress}.`);
            }
        }
        const vaultCollateralToken = await IERC20.at(vaultCollateralPrice.collateral.token);
        const ownerBalanceVaultCollateral = await vaultCollateralToken.balanceOf(this.agent.ownerAddress);
        if (ownerBalanceVaultCollateral.lte(STABLE_COIN_LOW_BALANCE)) {
            this.notifier.sendLowBalanceOnOwnersAddress(this.agent.ownerAddress, ownerBalanceVaultCollateral.toString(), vaultCollateralPrice.collateral.tokenFtsoSymbol);
            logger.info(`Owner ${this.agent.ownerAddress} has low balance of ${ownerBalanceClass1.toString()} ${collateralClass1Price.collateral.tokenFtsoSymbol}.`);
        }
        const ownerBalance = toBN(await web3.eth.getBalance(this.agent.ownerAddress));
        if (ownerBalance.lte(NATIVE_LOW_BALANCE)) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            this.notifier.sendLowBalanceOnOwnersAddress(this.agent.ownerAddress, ownerBalance.toString(), poolCollateralPrice.collateral.tokenFtsoSymbol);
            logger.info(`Owner ${this.agent.ownerAddress} has low balance of ${ownerBalance.toString()} ${collateralPoolPrice.collateral.tokenFtsoSymbol}.`);
        }
    }

    /**
     * Returns the value that is required to be topped up in order to reach healthy collateral ratio.
     * If value is less than zero, top up is not needed.
     */
    private async requiredTopUp(requiredCrBIPS: BN, agentInfo: AgentInfo, cp: CollateralPrice): Promise<BN> {
        const redeemingUBA = Number(cp.collateral.collateralClass) == CollateralClass.VAULT ? agentInfo.redeemingUBA : agentInfo.poolRedeemingUBA;
        const balance = toBN(Number(cp.collateral.collateralClass) == CollateralClass.VAULT ? agentInfo.totalVaultCollateralWei : agentInfo.totalPoolCollateralNATWei);
        const totalUBA = toBN(agentInfo.mintedUBA).add(toBN(agentInfo.reservedUBA)).add(toBN(redeemingUBA));
        const backingVaultCollateralWei = cp.convertUBAToTokenWei(totalUBA);
        const requiredCollateral = backingVaultCollateralWei.mul(requiredCrBIPS).divn(MAX_BIPS);
        return requiredCollateral.sub(balance);
    }

}
