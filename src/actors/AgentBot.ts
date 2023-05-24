import { FilterQuery, RequiredEntityData } from "@mikro-orm/core/typings";
import { CollateralReserved, MintingExecuted, RedemptionRequested } from "../../typechain-truffle/AssetManager";
import { EM } from "../config/orm";
import { AgentEntity, AgentMinting, AgentMintingState, AgentRedemption, AgentRedemptionState } from "../entities/agent";
import { AgentB } from "../fasset-bots/AgentB";
import { AgentBotDefaultSettings, IAssetAgentBotContext } from "../fasset-bots/IAssetBotContext";
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

    /**
     *
     * Creates AgentBot with newly created underlying address and with provided agent default settings.
     * Certain AgentBot properties are also stored in persistent state.
     */
    static async create(rootEm: EM, context: IAssetAgentBotContext, ownerAddress: string, agentSettingsConfig: AgentBotDefaultSettings, notifier: Notifier): Promise<AgentBot> {
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

    /**
     * This method fixes the underlying address to be used by given AgentBot owner.
     */
    static async proveEOAaddress(context: IAssetAgentBotContext, underlyingAddress: string, ownerAddress: string): Promise<void> {
        //TODO - what amount should be filled in -> 1 is not always a good fit
        const txHash = await context.wallet.addTransaction(underlyingAddress, underlyingAddress, 1, PaymentReference.addressOwnership(ownerAddress));
        await context.blockChainIndexerClient.waitForUnderlyingTransactionFinalization(txHash);
        const proof = await context.attestationProvider.provePayment(txHash, underlyingAddress, underlyingAddress);
        await context.assetManager.proveUnderlyingAddressEOA(proof, { from: ownerAddress });
    }

    /**
     * Create AgentBot from persistent state.
     */
    static async fromEntity(context: IAssetAgentBotContext, agentEntity: AgentEntity, notifier: Notifier): Promise<AgentBot> {
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

    /**
     * This is the main method, where "automatic" logic is gathered. In every step it firstly collects unhandled events and runs through them and handles them appropriately.
     * Then it checks if there are any minting or redemption in persistent storage, that needs to be handled.
     * Lastly, it checks if there are any actions ready to be handled for AgentBot in persistent state (such actions that need announcement beforehand or that are time locked).
     */
    async runStep(rootEm: EM): Promise<void> {
        await this.handleEvents(rootEm);
        await this.handleOpenMintings(rootEm);
        await this.handleOpenRedemptions(rootEm);
        await this.handleAgentsWaitingsAndCleanUp(rootEm);
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

    /**
     * Checks is there are any new events from assetManager.
     */
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

    /**
     * Checks and handles if there are any AgentBot actions (withdraw, exit available list, update AgentBot setting) waited to be executed due to required announcement or time lock.
     */
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
            lastUnderlyingBlock: toBN(request.lastUnderlyingBlock),
            lastUnderlyingTimestamp: toBN(request.lastUnderlyingTimestamp),
            paymentReference: request.paymentReference,
        } as RequiredEntityData<AgentMinting>, { persist: true });
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
        for (const rd of openMintings) {
            await this.nextMintingStep(rootEm, rd.id);
        }
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
    async mintingExecuted(em: EM, request: EventArgs<MintingExecuted>): Promise<void> {
        const minting = await this.findMinting(em, request.collateralReservationId);
        minting.state = AgentMintingState.DONE;
    }

    /**
     * Handles mintings stored in persistent state according to their state.
     */
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

    /**
     * When minting is in state STARTED, it checks if underlying payment proof for collateral reservation expired in indexer.
     * If proof expired (corner case), it calls unstickMinting, sets the state of minting in persistent state as DONE and send notification to owner.
     * If proof exists, it checks if time for payment expired on underlying. If if did not expire, then it does nothing.
     * If time for payment expired, it checks via indexer if transaction for payment exists.
     * If it does exists, then it requests for payment proof - see requestPaymentProofForMinting().
     * If it does not exist, then it request non payment proof - see requestNonPaymentProofForMinting().
     */
    async checkForNonPaymentProofOrExpiredProofs(minting: AgentMinting): Promise<void> {
        const proof = await this.checkProofExpiredInIndexer(minting.lastUnderlyingBlock, minting.lastUnderlyingTimestamp)
        if (proof) {
            // corner case: proof expires in indexer
            const settings = await this.context.assetManager.getSettings();
            const agentCollateral = await this.agent.getAgentCollateral();
            const burnNats = agentCollateral.pool.convertUBAToTokenWei(minting.valueUBA).mul(toBN(settings.class1BuyForFlareFactorBIPS)).divn(MAX_BIPS);
            await this.context.assetManager.unstickMinting(proof, minting.requestId, { from: this.agent.ownerAddress, value: burnNats });
            minting.state = AgentMintingState.DONE;
            this.notifier.sendMintingCornerCase(minting.requestId.toString(), true);
        } else {
            // proof did not expire
            const blockHeight = await this.context.chain.getBlockHeight();
            const latestBlock = await this.context.chain.getBlockAt(blockHeight);
            if (latestBlock && latestBlock.number > minting.lastUnderlyingBlock.toNumber() && latestBlock.timestamp > minting.lastUnderlyingTimestamp.toNumber()) {
                // time for payment expired on underlying
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

    /**
     * Sends request for minting payment proof, sets state for minting in persistent state to REQUEST_PAYMENT_PROOF and sends notification to owner,
     */
    async requestPaymentProofForMinting(minting: AgentMinting, txHash: string, sourceAddress: string): Promise<void> {
        const request = await this.context.attestationProvider.requestPaymentProof(txHash, sourceAddress, this.agent.underlyingAddress);
        minting.state = AgentMintingState.REQUEST_PAYMENT_PROOF;
        minting.proofRequestRound = request.round;
        minting.proofRequestData = request.data;
        this.notifier.sendMintingCornerCase(minting.requestId.toString());
    }

    /**
     * Sends request for minting non payment proof, sets state for minting in persistent state to REQUEST_NON_PAYMENT_PROOF and sends notification to owner,
     */
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

    /**
     * When minting is in state REQUEST_NON_PAYMENT_PROOF, it obtains non payment proof, calls mintingPaymentDefault and sets minting in persistent state to DONE.
     * If proof cannot be obtained, it sends notification to owner.
     */
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

    /**
     * When minting is in state REQUEST_PAYMENT_PROOF, it obtains payment proof, calls executeMinting and sets minting in persistent state to DONE.
     * If proof cannot be obtained, it sends notification to owner.
     */
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
    }

    /**
     * Marks stored redemption in persistent state as DONE, then it checks AgentBot's and owner's underlying balance.
     */
    async redemptionFinished(em: EM, requestId: BN, agentVault: string): Promise<void> {
        const redemption = await this.findRedemption(em, requestId);
        redemption.state = AgentRedemptionState.DONE;
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
        for (const rd of openRedemptions) {
            await this.nextRedemptionStep(rootEm, rd.id);
        }
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

    /**
     * When redemption is in state STARTED, it checks if payment proof expired in indexer.
     * If proof expired (corner case), it calls finishRedemptionWithoutPayment, sets the state of redemption in persistent state as DONE and send notification to owner.
     * If proof exists, it performs payment and sets the state of redemption in persistent state as PAID.
     */
    async payForRedemption(redemption: AgentRedemption): Promise<void> {
        const proof = await this.checkProofExpiredInIndexer(redemption.lastUnderlyingBlock, redemption.lastUnderlyingTimestamp)
        if (proof) {
            // corner case - agent did not pay
            await this.context.assetManager.finishRedemptionWithoutPayment(proof, redemption.requestId, { from: this.agent.ownerAddress });
            redemption.state = AgentRedemptionState.DONE;
            this.notifier.sendRedemptionCornerCase(redemption.requestId.toString(), redemption.agentAddress);
        } else {
            const paymentAmount = redemption.valueUBA.sub(redemption.feeUBA);
            // !!! TODO: what if there are too little funds on underlying address to pay for fee?
            const txHash = await this.agent.performPayment(redemption.paymentAddress, paymentAmount, redemption.paymentReference);
            redemption.txHash = txHash;
            redemption.state = AgentRedemptionState.PAID;
        }
    }

    /**
     * When redemption is in state PAID, it checks if payment proof expired in indexer.
     * If proof expired (corner case), it calls finishRedemptionWithoutPayment, sets the state of redemption in persistent state as DONE and send notification to owner.
     * If proof did not expire, it requests payment proof - see requestPaymentProof().
     */
    async checkPaymentProofAvailable(redemption: AgentRedemption): Promise<void> {
        const proof = await this.checkProofExpiredInIndexer(redemption.lastUnderlyingBlock, redemption.lastUnderlyingTimestamp)
        if (proof) {
            // corner case: proof expires in indexer
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

    /**
     * Sends request for redemption payment proof, sets state for redemption in persistent state to REQUESTED_PROOF.
     */
    async requestPaymentProof(redemption: AgentRedemption): Promise<void> {
        const request = await this.context.attestationProvider.requestPaymentProof(redemption.txHash ?? "", this.agent.underlyingAddress, redemption.paymentAddress);
        redemption.state = AgentRedemptionState.REQUESTED_PROOF;
        redemption.proofRequestRound = request.round;
        redemption.proofRequestData = request.data;
    }

    /**
     * When redemption is in state REQUESTED_PROOF, it obtains payment proof, calls confirmRedemptionPayment and sets the state of redemption in persistent state as DONE.
     * If proof expired (corner case), it calls finishRedemptionWithoutPayment, sets the state of redemption in persistent state as DONE and send notification to owner.
     * If proof cannot be obtained, it sends notification to owner.
     */
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

    /**
     * Checks if proof has expired in indexer.
     */
    async checkProofExpiredInIndexer(lastUnderlyingBlock: BN, lastUnderlyingTimestamp: BN): Promise<ProvedDH<DHConfirmedBlockHeightExists> | null> {
        const proof = await this.context.attestationProvider.proveConfirmedBlockHeightExists();
        const lqwBlock = toBN(proof.lowestQueryWindowBlockNumber);
        const lqwBTimestamp = toBN(proof.lowestQueryWindowBlockTimestamp);
        if (lqwBlock.gt(lastUnderlyingBlock) && lqwBTimestamp.gt(lastUnderlyingTimestamp)) {
            return proof;
        }
        return null;
    }

    /**
     * Marks stored AgentBot in persistent state as inactive after event 'AgentDestroyed' is received.
     */
    async handleAgentDestruction(em: EM, vaultAddress: string): Promise<void> {
        const agentBotEnt = await em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress } as FilterQuery<AgentEntity>);
        agentBotEnt.active = false;
    }

    /**
     * Checks AgentBot's and owner's underlying balance after redemption is finished. If AgentBot's balance is too low, it tries to top it up from owner's account. See 'underlyingTopUp(...)'.
     */
    async checkUnderlyingBalance(agentVault: string): Promise<void> {
        const freeUnderlyingBalance = toBN((await this.agent.getAgentInfo()).freeUnderlyingBalanceUBA);
        const estimatedFee = toBN(await this.context.wallet.getTransactionFee());
        if (freeUnderlyingBalance.lte(estimatedFee.muln(NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR))) {
            await this.underlyingTopUp(estimatedFee.muln(NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR), agentVault, freeUnderlyingBalance);
        }
    }

    /**
     * Tries to top up AgentBot's underlying account owner's. It notifies about successful and unsuccessful try.
     * It also checks owner's underlying balance and notifies when it is too low.
     */
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

    /**
     * Checks both AgentBot's collateral ratios. In case of either being unhealthy, it tries to top up from owner's account in order to get out of Collateral Ratio Band or Liquidation due to price changes.
     * It sends notification about successful and unsuccessful top up.
     * At the end it also checks owner's balance and notifies when too low.
     */
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
                await this.agent.buyCollateralPoolTokens(requiredTopUpPool);//TODO - is that ok to increase cr
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

    /**
     * Returns the value that is required to be topped up in order to reach healthy collateral ratio.
     * If value is less than zero, top up is not needed.
     */
    private async requiredTopUp(requiredCrBIPS: BN, agentInfo: AgentInfo, cd: CollateralData): Promise<BN> {
        const totalUBA = toBN(agentInfo.mintedUBA).add(toBN(agentInfo.reservedUBA)).add(toBN(agentInfo.redeemingUBA));
        const backingClass1Wei = cd.convertUBAToTokenWei(totalUBA);
        const requiredCollateral = backingClass1Wei.mul(requiredCrBIPS).divn(MAX_BIPS);
        return requiredCollateral.sub(cd.balance);
    }

}
