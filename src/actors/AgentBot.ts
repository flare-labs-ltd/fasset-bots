import { FilterQuery, RequiredEntityData } from "@mikro-orm/core/typings";
import { CollateralReserved, MintingExecuted, RedemptionRequested } from "../../typechain-truffle/AssetManager";
import { EM } from "../config/orm";
import { AgentEntity, AgentMinting, AgentMintingState, AgentRedemption, AgentRedemptionState } from "../entities/agent";
import { AgentB } from "../fasset-bots/AgentB";
import { AgentBotSettings, IAssetBotContext } from "../fasset-bots/IAssetBotContext";
import { AgentInfo, AgentSettings } from "../fasset/AssetManagerTypes";
import { PaymentReference } from "../fasset/PaymentReference";
import { ProvedDH } from "../underlying-chain/AttestationHelper";
import { artifacts } from "../utils/artifacts";
import { EventArgs, EvmEvent } from "../utils/events/common";
import { eventIs } from "../utils/events/truffle";
import { Web3EventDecoder } from "../utils/events/Web3EventDecoder";
import { BN_ZERO, CCB_LIQUIDATION_PREVENTION_FACTOR, MAX_BIPS, NATIVE_LOW_BALANCE, NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR, STABLE_COIN_LOW_BALANCE, requireEnv, toBN } from "../utils/helpers";
import { Notifier } from "../utils/Notifier";
import { web3 } from "../utils/web3";
import { DHConfirmedBlockHeightExists, DHPayment, DHReferencedPaymentNonexistence } from "../verification/generated/attestation-hash-types";
import { CollateralData } from "../fasset/CollateralData";
import { latestBlockTimestampBN } from "../utils/web3helpers";

const AgentVault = artifacts.require('AgentVault');
const CollateralPool = artifacts.require('CollateralPool');
const CollateralPoolToken = artifacts.require('CollateralPoolToken');
const IERC20 = artifacts.require('IERC20');

export class AgentBot {
    constructor(
        public agent: AgentB,
        public notifier: Notifier
    ) { }

    context = this.agent.context;
    eventDecoder = new Web3EventDecoder({ assetManager: this.context.assetManager, ftsoManager: this.context.ftsoManager });

    static async create(rootEm: EM, context: IAssetBotContext, ownerAddress: string, agentSettingsConfig: AgentBotSettings, notifier: Notifier,): Promise<AgentBot> {
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
            agentEntity.collateralPoolAddress = agent.collateralPool.address
            em.persist(agentEntity);
            return new AgentBot(agent, notifier);
        });
    }

    static async proveEOAaddress(context: IAssetBotContext, underlyingAddress: string, ownerAddress: string): Promise<void> {
        const txHash = await context.wallet.addTransaction(underlyingAddress, underlyingAddress, 1, PaymentReference.addressOwnership(ownerAddress));
        await context.blockChainIndexerClient.waitForUnderlyingTransactionFinalization(txHash);
        const proof = await context.attestationProvider.provePayment(txHash, underlyingAddress, underlyingAddress);
        await context.assetManager.proveUnderlyingAddressEOA(proof, { from: ownerAddress });
    }

    static async fromEntity(context: IAssetBotContext, agentEntity: AgentEntity, notifier: Notifier): Promise<AgentBot> {
        const agentVault = await AgentVault.at(agentEntity.vaultAddress);
        // get collateral pool
        const collateralPool = await CollateralPool.at(agentEntity.collateralPoolAddress);
        // get pool token
        const poolTokenAddress = await collateralPool.poolToken();
        const collateralPoolToken = await CollateralPoolToken.at(poolTokenAddress);
        // agent
        const agent = new AgentB(context, agentEntity.ownerAddress, agentVault, collateralPool, collateralPoolToken, agentEntity.underlyingAddress);
        return new AgentBot(agent, notifier);
    }

    async runStep(rootEm: EM): Promise<void> {
        await this.handleEvents(rootEm);
        await this.handleOpenMintings(rootEm);
        await this.handleOpenRedemptions(rootEm);
        await this.handleAgentsWaitingsAndCleanUp(rootEm);
    }

    async handleEvents(rootEm: EM): Promise<void> {
        await rootEm.transactional(async em => {
            const events = await this.readUnhandledEvents(em);
            // Note: only update db here, so that retrying on error won't retry on-chain operations.
            for (const event of events) {
                if (eventIs(event, this.context.assetManager, 'CollateralReserved')) {
                    this.mintingStarted(em, event.args);
                } else if (eventIs(event, this.context.assetManager, 'CollateralReservationDeleted')) {
                    await this.mintingExecuted(em, event.args);
                } else if (eventIs(event, this.context.assetManager, 'MintingExecuted')) {
                    await this.mintingExecuted(em, event.args);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionRequested')) {
                    this.redemptionStarted(em, event.args);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionDefault')) {
                    this.notifier.sendRedemptionDefaulted(event.args.requestId.toString(), event.args.redeemer, event.args.agentVault);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionPerformed')) {
                    await this.redemptionFinished(em, event.args.requestId, event.args.agentVault);
                    this.notifier.sendRedemptionWasPerformed(event.args.requestI, event.args.redeemer, event.args.agentVault);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionPaymentFailed')) {
                    await this.redemptionFinished(em, event.args.requestId, event.args.agentVault);
                    this.notifier.sendRedemptionFailedOrBlocked(event.args.requestId.toString(), event.args.transactionHash, event.args.redeemer, event.args.agentVault, event.args.failureReason);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionPaymentBlocked')) {
                    await this.redemptionFinished(em, event.args.requestId, event.args.agentVault);
                    this.notifier.sendRedemptionFailedOrBlocked(event.args.requestId.toString(), event.args.transactionHash, event.args.redeemer, event.args.agentVault);
                } else if (eventIs(event, this.context.assetManager, 'AgentDestroyed')) {
                    await this.handleAgentDestruction(em, event.args.agentVault);
                } else if (eventIs(event, this.context.ftsoManager, 'PriceEpochFinalized')) {
                    await this.checkAgentForCollateralRatiosAndTopUp();
                } else if (eventIs(event, this.context.assetManager, 'AgentInCCB')) {
                    this.notifier.sendCCBAlert(event.args.agentVault, event.args.timestamp);
                } else if (eventIs(event, this.context.assetManager, 'LiquidationStarted')) {
                    this.notifier.sendLiquidationStartAlert(event.args.agentVault, event.args.timestamp);
                } else if (eventIs(event, this.context.assetManager, 'LiquidationPerformed')) {
                    this.notifier.sendLiquidationWasPerformed(event.args.agentVault, event.args.valueUBA);
                } else if (eventIs(event, this.context.assetManager, "UnderlyingBalanceTooLow")) {
                    this.notifier.sendFullLiquidationAlert(event.args.agentVault, event.args.timestamp);
                } else if (eventIs(event, this.context.assetManager, "DuplicatePaymentConfirmed")) {
                    this.notifier.sendFullLiquidationAlert(event.args.agentVault, event.args.timestamp, event.args.transactionHash1, event.args.transactionHash2);
                } else if (eventIs(event, this.context.assetManager, "IllegalPaymentConfirmed")) {
                    this.notifier.sendFullLiquidationAlert(event.args.agentVault, event.args.timestamp, event.args.transactionHash);
                }
            }
        }).catch(error => {
            console.error(`Error handling events for agent ${this.agent.vaultAddress}: ${error}`);
        });
    }

    async readUnhandledEvents(em: EM): Promise<EvmEvent[]> {
        const agentEnt = await em.findOneOrFail(AgentEntity, { vaultAddress: this.agent.vaultAddress } as FilterQuery<AgentEntity>);
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
        agentEnt.lastEventBlockHandled = lastBlock;
        return events;
    }

    async handleAgentsWaitingsAndCleanUp(rootEm: EM): Promise<void> {
        await rootEm.transactional(async em => {
            const agentEnt = await em.findOneOrFail(AgentEntity, { vaultAddress: this.agent.vaultAddress } as FilterQuery<AgentEntity>);
            if (agentEnt.waitingForDestructionTimestamp.gt(BN_ZERO)) {
                const latestTimestamp = await latestBlockTimestampBN();
                if (agentEnt.waitingForDestructionTimestamp.lte(latestTimestamp)) {
                    await this.agent.destroy();
                    agentEnt.waitingForDestructionTimestamp = BN_ZERO;
                    await this.handleAgentDestruction(em, agentEnt.vaultAddress);
                }
            }
            if (agentEnt.withdrawalAllowedAtTimestamp.gt(BN_ZERO)) {
                const latestTimestamp = await latestBlockTimestampBN();
                if (agentEnt.withdrawalAllowedAtTimestamp.lte(latestTimestamp)) {
                    await this.agent.withdrawClass1Collateral(agentEnt.withdrawalAllowedAtAmount);
                    agentEnt.withdrawalAllowedAtTimestamp = BN_ZERO;
                    agentEnt.withdrawalAllowedAtAmount = BN_ZERO;
                }
            }
            if (agentEnt.agentSettingUpdateValidAtTimestamp.gt(BN_ZERO)) {
                const latestTimestamp = await latestBlockTimestampBN();
                if (agentEnt.agentSettingUpdateValidAtTimestamp.lte(latestTimestamp)) {
                    await this.agent.executeAgentSettingUpdate(agentEnt.agentSettingUpdateValidAtName);
                    agentEnt.agentSettingUpdateValidAtTimestamp = BN_ZERO;
                    agentEnt.agentSettingUpdateValidAtName = "";
                }
            }
            if (agentEnt.exitAvailableAllowedAtTimestamp.gt(BN_ZERO) && agentEnt.waitingForDestructionCleanUp) {
                await this.exitAvailable(agentEnt);
            } else if (agentEnt.exitAvailableAllowedAtTimestamp.gt(BN_ZERO)) {
                await this.exitAvailable(agentEnt);
            } else if (agentEnt.waitingForDestructionCleanUp) {
                const agentInfo = await this.agent.getAgentInfo();
                if (toBN(agentInfo.mintedUBA).eq(BN_ZERO) && toBN(agentInfo.redeemingUBA).eq(BN_ZERO) && toBN(agentInfo.reservedUBA).eq(BN_ZERO) && toBN(agentInfo.poolRedeemingUBA).eq(BN_ZERO)) {
                    const destroyAllowedAt = await this.agent.announceDestroy();
                    agentEnt.waitingForDestructionTimestamp = destroyAllowedAt;
                    agentEnt.waitingForDestructionCleanUp = false;
                }
            }
            if (agentEnt.underlyingWithdrawalAnnouncedAtTimestamp.gt(BN_ZERO)) {
                if (agentEnt.underlyingWithdrawalConfirmTransaction.length) {
                    const announcedUnderlyingConfirmationMinSeconds = toBN((await this.context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds);
                    const latestTimestamp = await latestBlockTimestampBN();
                    if ((agentEnt.underlyingWithdrawalAnnouncedAtTimestamp.add(announcedUnderlyingConfirmationMinSeconds)).lt(latestTimestamp)) {
                        await this.agent.confirmUnderlyingWithdrawal(agentEnt.underlyingWithdrawalConfirmTransaction);
                        agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = BN_ZERO;
                        agentEnt.underlyingWithdrawalConfirmTransaction = "";
                    }
                } else {
                    const announcedUnderlyingConfirmationMinSeconds = toBN((await this.context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds);
                    const latestTimestamp = await latestBlockTimestampBN();
                    if ((agentEnt.underlyingWithdrawalAnnouncedAtTimestamp.add(announcedUnderlyingConfirmationMinSeconds)).lt(latestTimestamp)) {
                        await this.agent.cancelUnderlyingWithdrawal();
                        agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = BN_ZERO;
                    }
                }
            }
        });
    }

    async exitAvailable(agentEnt: AgentEntity) {
        const latestTimestamp = await latestBlockTimestampBN();
        if (agentEnt.exitAvailableAllowedAtTimestamp.lte(latestTimestamp)) {
            await this.agent.exitAvailable();
            agentEnt.exitAvailableAllowedAtTimestamp = BN_ZERO;
        }
    }

    mintingStarted(em: EM, request: EventArgs<CollateralReserved>): void {
        em.create(AgentMinting, {
            state: AgentMintingState.STARTED,
            agentAddress: this.agent.vaultAddress,
            agentUnderlyingAddress: this.agent.underlyingAddress,
            requestId: toBN(request.collateralReservationId),
            valueUBA: toBN(request.valueUBA),
            feeUBA: toBN(request.feeUBA),
            lastUnderlyingBlock: toBN(request.lastUnderlyingBlock),
            lastUnderlyingTimestamp: toBN(request.lastUnderlyingTimestamp),
            paymentReference: request.paymentReference,
        } as RequiredEntityData<AgentMinting>, { persist: true });
    }

    async findMinting(em: EM, requestId: BN): Promise<AgentMinting> {
        const agentAddress = this.agent.vaultAddress;
        return await em.findOneOrFail(AgentMinting, { agentAddress, requestId } as FilterQuery<AgentMinting>);
    }

    async handleOpenMintings(rootEm: EM): Promise<void> {
        const openMintings = await this.openMintings(rootEm, true);
        for (const rd of openMintings) {
            await this.nextMintingStep(rootEm, rd.id);
        }
    }

    async openMintings(em: EM, onlyIds: boolean): Promise<AgentMinting[]> {
        let query = em.createQueryBuilder(AgentMinting);
        if (onlyIds) query = query.select('id');
        return await query.where({ agentAddress: this.agent.vaultAddress })
            .andWhere({ $not: { state: AgentMintingState.DONE } })
            .getResultList();
    }

    async mintingExecuted(em: EM, request: EventArgs<MintingExecuted>): Promise<void> {
        const minting = await this.findMinting(em, request.collateralReservationId);
        minting.state = AgentMintingState.DONE;
    }

    async nextMintingStep(rootEm: EM, id: number): Promise<void> {
        await rootEm.transactional(async em => {
            const minting = await em.getRepository(AgentMinting).findOneOrFail({ id: Number(id) } as FilterQuery<AgentMinting>);
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
            }
        }).catch(() => {
            console.error(`Error handling next minting step for minting ${id} agent ${this.agent.vaultAddress}`);
        });
    }

    async checkForNonPaymentProofOrExpiredProofs(minting: AgentMinting): Promise<void> {
        // corner case: proof expires in indexer
        const proof = await this.checkProofExpiredInIndexer(minting.lastUnderlyingBlock, minting.lastUnderlyingTimestamp)
        if (proof) {
            const settings = await this.context.assetManager.getSettings();
            const agentCollateral = await this.agent.getAgentCollateral();
            const burnNats = agentCollateral.pool.convertUBAToTokenWei(minting.valueUBA).mul(toBN(settings.class1BuyForFlareFactorBIPS)).divn(MAX_BIPS);
            await this.context.assetManager.unstickMinting(proof, minting.requestId, { from: this.agent.ownerAddress, value: burnNats });
            minting.state = AgentMintingState.DONE;
            this.notifier.sendMintingCornerCase(minting.requestId.toString(), true);
        } else {
            const blockHeight = await this.context.chain.getBlockHeight();
            const latestBlock = await this.context.chain.getBlockAt(blockHeight);
            // time expires on underlying
            if (latestBlock && latestBlock.number > minting.lastUnderlyingBlock.toNumber() && latestBlock.timestamp > minting.lastUnderlyingTimestamp.toNumber()) {
                const txs = await this.agent.context.blockChainIndexerClient.getTransactionsByReference(minting.paymentReference);
                if (txs.length === 1) {
                    // corner case: minter pays and doesn't execute minting
                    // check minter paid -> request payment proof -> execute minting
                    const txHash = txs[0].hash;
                    // TODO is it ok to check first address in UTXO chains?
                    const sourceAddress = txs[0].inputs[0][0];
                    await this.requestPaymentProofForMinting(minting, txHash, sourceAddress)
                } else if (txs.length === 0) {
                    // minter did not pay -> request non payment proof -> unstick minting
                    await this.requestNonPaymentProofForMinting(minting);
                }
            }
        }
    }

    async requestPaymentProofForMinting(minting: AgentMinting, txHash: string, sourceAddress: string): Promise<void> {
        const request = await this.context.attestationProvider.requestPaymentProof(txHash, sourceAddress, this.agent.underlyingAddress);
        minting.state = AgentMintingState.REQUEST_PAYMENT_PROOF;
        minting.proofRequestRound = request.round;
        minting.proofRequestData = request.data;
        this.notifier.sendMintingCornerCase(minting.requestId.toString());
    }

    async requestNonPaymentProofForMinting(minting: AgentMinting): Promise<void> {
        const request = await this.context.attestationProvider.requestReferencedPaymentNonexistenceProof(
            minting.agentUnderlyingAddress,
            minting.paymentReference,
            minting.valueUBA.add(minting.feeUBA),
            minting.lastUnderlyingBlock.toNumber(),
            minting.lastUnderlyingTimestamp.toNumber());
        minting.state = AgentMintingState.REQUEST_NON_PAYMENT_PROOF;
        minting.proofRequestRound = request.round;
        minting.proofRequestData = request.data;
    }

    async checkNonPayment(minting: AgentMinting): Promise<void> {
        const proof = await this.context.attestationProvider.obtainReferencedPaymentNonexistenceProof(minting.proofRequestRound ?? 0, minting.proofRequestData ?? "");
        if (!proof.finalized) return;
        if (proof.result && proof.result.merkleProof) {
            const nonPaymentProof = proof.result as ProvedDH<DHReferencedPaymentNonexistence>;
            await this.context.assetManager.mintingPaymentDefault(nonPaymentProof, minting.requestId, { from: this.agent.ownerAddress });
            minting.state = AgentMintingState.DONE;
        } else {
            this.notifier.sendNoProofObtained(minting.agentAddress, minting.requestId.toString(), minting.proofRequestRound ?? 0, minting.proofRequestData ?? "");
        }
    }

    async checkPaymentAndExecuteMinting(minting: AgentMinting): Promise<void> {
        const proof = await this.context.attestationProvider.obtainPaymentProof(minting.proofRequestRound ?? 0, minting.proofRequestData ?? "");
        if (!proof.finalized) return;
        if (proof.result && proof.result.merkleProof) {
            const paymentProof = proof.result as ProvedDH<DHPayment>;
            await this.context.assetManager.executeMinting(paymentProof, minting.requestId, { from: this.agent.ownerAddress });
            minting.state = AgentMintingState.DONE;
        } else {
            this.notifier.sendNoProofObtained(minting.agentAddress, minting.requestId.toString(), minting.proofRequestRound ?? 0, minting.proofRequestData ?? "");
        }
    }

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
    }

    async redemptionFinished(em: EM, requestId: BN, agentVault: string): Promise<void> {
        const redemption = await this.findRedemption(em, requestId);
        redemption.state = AgentRedemptionState.DONE;
        await this.checkUnderlyingBalance(agentVault);
    }

    async findRedemption(em: EM, requestId: BN): Promise<AgentRedemption> {
        const agentAddress = this.agent.vaultAddress;
        return await em.findOneOrFail(AgentRedemption, { agentAddress, requestId } as FilterQuery<AgentRedemption>);
    }

    async handleOpenRedemptions(rootEm: EM): Promise<void> {
        const openRedemptions = await this.openRedemptions(rootEm, true);
        for (const rd of openRedemptions) {
            await this.nextRedemptionStep(rootEm, rd.id);
        }
    }

    async openRedemptions(em: EM, onlyIds: boolean): Promise<AgentRedemption[]> {
        let query = em.createQueryBuilder(AgentRedemption);
        if (onlyIds) query = query.select('id');
        return await query.where({ agentAddress: this.agent.vaultAddress })
            .andWhere({ $not: { state: AgentRedemptionState.DONE } })
            .getResultList();
    }

    async nextRedemptionStep(rootEm: EM, id: number): Promise<void> {
        await rootEm.transactional(async em => {
            const redemption = await em.getRepository(AgentRedemption).findOneOrFail({ id: Number(id) } as FilterQuery<AgentRedemption>);
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
            }
        }).catch(() => {
            console.error(`Error handling next redemption step for redemption ${id} agent ${this.agent.vaultAddress}`);
        });
    }

    async payForRedemption(redemption: AgentRedemption): Promise<void> {
        const proof = await this.checkProofExpiredInIndexer(redemption.lastUnderlyingBlock, redemption.lastUnderlyingTimestamp)
        if (proof) {
            await this.context.assetManager.finishRedemptionWithoutPayment(proof, redemption.requestId, { from: this.agent.ownerAddress });
            redemption.state = AgentRedemptionState.DONE;
        } else {
            const paymentAmount = redemption.valueUBA.sub(redemption.feeUBA);
            // !!! TODO: what if there are too little funds on underlying address to pay for fee?
            const txHash = await this.agent.performPayment(redemption.paymentAddress, paymentAmount, redemption.paymentReference);
            redemption.txHash = txHash;
            redemption.state = AgentRedemptionState.PAID;
        }
    }

    async checkPaymentProofAvailable(redemption: AgentRedemption): Promise<void> {
        // corner case: proof expires in indexer
        const proof = await this.checkProofExpiredInIndexer(redemption.lastUnderlyingBlock, redemption.lastUnderlyingTimestamp)
        if (proof) {
            await this.context.assetManager.finishRedemptionWithoutPayment(proof, redemption.requestId, { from: this.agent.ownerAddress });
            redemption.state = AgentRedemptionState.DONE;
            this.notifier.sendRedemptionCornerCase(redemption.requestId.toString(), redemption.agentAddress);
        } else {
            const txBlock = await this.context.chain.getTransactionBlock(redemption.txHash ?? "");
            const blockHeight = await this.context.chain.getBlockHeight();
            if (txBlock != null && blockHeight - txBlock.number >= this.context.chain.finalizationBlocks) {
                await this.requestPaymentProof(redemption);
            }
        }
    }

    async requestPaymentProof(redemption: AgentRedemption): Promise<void> {
        const request = await this.context.attestationProvider.requestPaymentProof(redemption.txHash ?? "", this.agent.underlyingAddress, redemption.paymentAddress);
        redemption.state = AgentRedemptionState.REQUESTED_PROOF;
        redemption.proofRequestRound = request.round;
        redemption.proofRequestData = request.data;
    }

    async checkConfirmPayment(redemption: AgentRedemption): Promise<void> {
        const proof = await this.context.attestationProvider.obtainPaymentProof(redemption.proofRequestRound ?? 0, redemption.proofRequestData ?? "");
        if (!proof.finalized) return;
        if (proof.result && proof.result.merkleProof) {
            const paymentProof = proof.result as ProvedDH<DHPayment>;
            await this.context.assetManager.confirmRedemptionPayment(paymentProof, redemption.requestId, { from: this.agent.ownerAddress });
            redemption.state = AgentRedemptionState.DONE;
        } else {
            this.notifier.sendNoProofObtained(redemption.agentAddress, redemption.requestId.toString(), redemption.proofRequestRound ?? 0, redemption.proofRequestData ?? "", true);
        }
    }

    async checkProofExpiredInIndexer(lastUnderlyingBlock: BN, lastUnderlyingTimestamp: BN): Promise<ProvedDH<DHConfirmedBlockHeightExists> | null> {
        const proof = await this.context.attestationProvider.proveConfirmedBlockHeightExists();
        const lqwBlock = toBN(proof.lowestQueryWindowBlockNumber);
        const lqwBTimestamp = toBN(proof.lowestQueryWindowBlockTimestamp);
        if (lqwBlock.gt(lastUnderlyingBlock) && lqwBTimestamp.gt(lastUnderlyingTimestamp)) {
            return proof;
        }
        return null;
    }

    async handleAgentDestruction(em: EM, vaultAddress: string): Promise<void> {
        const agentBotEnt = await em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress } as FilterQuery<AgentEntity>);
        agentBotEnt.active = false;
    }

    async checkUnderlyingBalance(agentVault: string): Promise<void> {
        const freeUnderlyingBalance = toBN((await this.agent.getAgentInfo()).freeUnderlyingBalanceUBA);
        const estimatedFee = toBN(await this.context.wallet.getTransactionFee());
        if (freeUnderlyingBalance.lte(estimatedFee.muln(NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR))) {
            await this.underlyingTopUp(estimatedFee.muln(NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR), agentVault, freeUnderlyingBalance);
        }
    }

    async underlyingTopUp(amount: BN, agentVault: string, freeUnderlyingBalance: BN): Promise<void> {
        const ownerUnderlyingAddress = requireEnv('OWNER_UNDERLYING_ADDRESS');
        try {
            const txHash = await this.agent.performTopupPayment(amount, ownerUnderlyingAddress);
            await this.agent.confirmTopupPayment(txHash);
            this.notifier.sendLowUnderlyingAgentBalance(agentVault, amount.toString());
        } catch (error) {
            this.notifier.sendLowUnderlyingAgentBalanceFailed(agentVault, freeUnderlyingBalance.toString());
        }
        const ownerUnderlyingBalance = await this.context.chain.getBalance(ownerUnderlyingAddress);
        const estimatedFee = toBN(await this.context.wallet.getTransactionFee());
        if (ownerUnderlyingBalance.lte(estimatedFee.muln(NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR))) {
            this.notifier.sendLowBalanceOnUnderlyingOwnersAddress(ownerUnderlyingAddress, ownerUnderlyingBalance.toString());
        }
    }

    // owner deposits class1 collateral to vault or pool to get out of ccb or liquidation due to price changes
    async checkAgentForCollateralRatiosAndTopUp(): Promise<void> {
        const agentInfo = await this.agent.getAgentInfo();
        const agentCollateral = await this.agent.getAgentCollateral();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const requiredCrClass1BIPS = toBN(agentCollateral.class1.collateral!.ccbMinCollateralRatioBIPS).muln(CCB_LIQUIDATION_PREVENTION_FACTOR);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const requiredCrPoolBIPS = toBN(agentCollateral.pool.collateral!.ccbMinCollateralRatioBIPS).muln(CCB_LIQUIDATION_PREVENTION_FACTOR);
        const requiredTopUpClass1 = await this.requiredTopUp(requiredCrClass1BIPS, agentInfo, agentCollateral.class1);
        const requiredTopUpPool = await this.requiredTopUp(requiredCrPoolBIPS, agentInfo, agentCollateral.pool);
        if (requiredTopUpClass1.lte(BN_ZERO) && requiredTopUpPool.lte(BN_ZERO)) {
            // no need for top up
        }
        if (requiredTopUpClass1.gt(BN_ZERO)) {
            try {
                await this.agent.depositClass1Collateral(requiredTopUpClass1);
                this.notifier.sendCollateralTopUpAlert(this.agent.vaultAddress, requiredTopUpClass1.toString());
            } catch (err) {
                this.notifier.sendCollateralTopUpFailedAlert(this.agent.vaultAddress, requiredTopUpClass1.toString());
            }
        }
        if (requiredTopUpPool.gt(BN_ZERO)) {
            try {
                await this.agent.buyCollateralPoolTokens(requiredTopUpPool);
                this.notifier.sendCollateralTopUpAlert(this.agent.vaultAddress, requiredTopUpPool.toString(), true);
            } catch (err) {
                this.notifier.sendCollateralTopUpFailedAlert(this.agent.vaultAddress, requiredTopUpPool.toString(), true);
            }
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const tokenClass1 = await IERC20.at(agentCollateral.class1.collateral!.token);
        const ownerBalanceClass1 = await tokenClass1.balanceOf(this.agent.ownerAddress);
        if (ownerBalanceClass1.lte(STABLE_COIN_LOW_BALANCE)) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            this.notifier.sendLowBalanceOnOwnersAddress(this.agent.ownerAddress, ownerBalanceClass1.toString(), agentCollateral.class1.collateral!.tokenFtsoSymbol);
        }
        const ownerBalance = toBN(await web3.eth.getBalance(this.agent.ownerAddress));
        if (ownerBalance.lte(NATIVE_LOW_BALANCE)) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            this.notifier.sendLowBalanceOnOwnersAddress(this.agent.ownerAddress, ownerBalance.toString(), agentCollateral.pool.collateral!.tokenFtsoSymbol);
        }
    }

    private async requiredTopUp(requiredCrBIPS: BN, agentInfo: AgentInfo, cd: CollateralData): Promise<BN> {
        const totalUBA = toBN(agentInfo.mintedUBA).add(toBN(agentInfo.reservedUBA)).add(toBN(agentInfo.redeemingUBA));
        const backingClass1Wei = cd.convertUBAToTokenWei(totalUBA);
        const requiredCollateral = backingClass1Wei.mul(requiredCrBIPS).divn(MAX_BIPS);
        return requiredCollateral.sub(cd.balance);
    }

}
