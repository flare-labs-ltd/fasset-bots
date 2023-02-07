import { FilterQuery, RequiredEntityData } from "@mikro-orm/core/typings";
import BN from "bn.js";
import { AgentDestroyed, CollateralReserved, MintingExecuted, RedemptionDefault, RedemptionRequested } from "../../typechain-truffle/AssetManager";
import { EM } from "../config/orm";
import { AgentEntity, AgentMinting, AgentMintingState, AgentRedemption, AgentRedemptionState } from "../entities/agent";
import { AgentB } from "../fasset-bots/AgentB";
import { IAssetBotContext } from "../fasset-bots/IAssetBotContext";
import { AgentInfo, AssetManagerSettings } from "../fasset/AssetManagerTypes";
import { amgToNATWeiPrice, convertUBAToNATWei } from "../fasset/Conversions";
import { PaymentReference } from "../fasset/PaymentReference";
import { MockNotifier } from "../mock/MockNotifier";
import { ProvedDH } from "../underlying-chain/AttestationHelper";
import { artifacts } from "../utils/artifacts";
import { EventArgs, EvmEvent } from "../utils/events/common";
import { eventIs } from "../utils/events/truffle";
import { Web3EventDecoder } from "../utils/events/Web3EventDecoder";
import { BN_ZERO, CCB_LIQUIDATION_PREVENTION_FACTOR, MAX_BIPS, NATIVE_LOW_BALANCE, NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR, requireEnv, toBN } from "../utils/helpers";
import { web3 } from "../utils/web3";
import { DHConfirmedBlockHeightExists, DHPayment, DHReferencedPaymentNonexistence } from "../verification/generated/attestation-hash-types";

// status as returned from getAgentInfo
export enum AgentStatus {
    NORMAL = 0,             // agent is operating normally
    CCB = 1,                // agent in collateral call band
    LIQUIDATION = 2,        // liquidation due to collateral ratio - ends when agent is healthy
    FULL_LIQUIDATION = 3,   // illegal payment liquidation - always liquidates all and then agent must close vault
    DESTROYING = 4,         // agent announced destroy, cannot mint again; all existing mintings have been redeemed before
}

const AgentVault = artifacts.require('AgentVault');

export class AgentBot {
    constructor(
        public agent: AgentB
    ) { }

    notifier = new MockNotifier();
    context = this.agent.context;
    eventDecoder = new Web3EventDecoder({ assetManager: this.context.assetManager, ftsoManager: this.context.ftsoManager });

    static async create(rootEm: EM, context: IAssetBotContext, ownerAddress: string): Promise<AgentBot> {
        const lastBlock = await web3.eth.getBlockNumber();
        return await rootEm.transactional(async em => {
            const underlyingAddress = await context.wallet.createAccount();
            const settings = await context.assetManager.getSettings();
            if (settings.requireEOAAddressProof) {
                await this.proveEOAaddress(context, underlyingAddress, ownerAddress);
            }
            const agent = await AgentB.create(context, ownerAddress, underlyingAddress);
            const agentEntity = new AgentEntity();
            agentEntity.chainId = context.chainInfo.chainId;
            agentEntity.ownerAddress = agent.ownerAddress;
            agentEntity.vaultAddress = agent.vaultAddress;
            agentEntity.underlyingAddress = agent.underlyingAddress;
            agentEntity.active = true;
            agentEntity.lastEventBlockHandled = lastBlock;
            em.persist(agentEntity);
            return new AgentBot(agent);
        });
    }

    static async proveEOAaddress(context: IAssetBotContext, underlyingAddress: string, ownerAddress: string): Promise<void> {
        const txHash = await context.wallet.addTransaction(underlyingAddress, underlyingAddress, 1, PaymentReference.addressOwnership(ownerAddress));
        await context.blockChainIndexerClient.waitForUnderlyingTransactionFinalization(txHash);
        const proof = await context.attestationProvider.provePayment(txHash, underlyingAddress, underlyingAddress);
        await context.assetManager.proveUnderlyingAddressEOA(proof, { from: ownerAddress });
    }

    static async fromEntity(context: IAssetBotContext, agentEntity: AgentEntity): Promise<AgentBot> {
        const agentVault = await AgentVault.at(agentEntity.vaultAddress);
        const agent = new AgentB(context, agentEntity.ownerAddress, agentVault, agentEntity.underlyingAddress);
        return new AgentBot(agent);
    }

    async runStep(rootEm: EM): Promise<void> {
        await this.handleEvents(rootEm);
        await this.handleOpenMintings(rootEm);
        await this.handleOpenRedemptions(rootEm);
    }

    async handleEvents(rootEm: EM): Promise<void> {
        await rootEm.transactional(async em => {
            const events = await this.readUnhandledEvents(em);
            // Note: only update db here, so that retrying on error won't retry on-chain operations.
            for (const event of events) {
                // console.log(this.context.assetManager.address, event.address, event.event);
                if (eventIs(event, this.context.assetManager, 'CollateralReserved')) {
                    this.mintingStarted(em, event.args);
                } else if (eventIs(event, this.context.assetManager, 'CollateralReservationDeleted')) {
                    await this.mintingExecuted(em, event.args);
                } else if (eventIs(event, this.context.assetManager, 'MintingExecuted')) {
                    await this.mintingExecuted(em, event.args);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionRequested')) {
                    this.redemptionStarted(em, event.args);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionDefault')) {
                    await this.redemptionFinished(em, event.args);
                    this.notifier.sendRedemptionDefaulted(event.args.requestId.toString(), event.args.transactionHash, event.args.redeemer);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionFinished')) {
                    await this.redemptionFinished(em, event.args);
                    await this.checkUnderlyingBalance(event.args.agentVault);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionPaymentFailed')) {
                    this.notifier.sendRedemptionFailedOrBlocked(event.args.requestId.toString(), event.args.transactionHash, event.args.redeemer, event.args.failureReason);
                } else if (eventIs(event, this.context.assetManager, 'RedemptionPaymentBlocked')) {
                    this.notifier.sendRedemptionFailedOrBlocked(event.args.requestId.toString(), event.args.transactionHash, event.args.redeemer);
                } else if (eventIs(event, this.context.assetManager, 'AgentDestroyed')) {
                    await this.handleAgentDestruction(em, event.args);
                } else if (eventIs(event, this.context.ftsoManager, 'PriceEpochFinalized')) {
                    await this.checkAgentForCollateralRatioAndTopUp();
                } else if (eventIs(event, this.context.assetManager, 'AgentInCCB')) {
                    this.notifier.sendCCBAlert(event.args.agentVault);
                } else if (eventIs(event, this.context.assetManager, 'LiquidationStarted')) {
                    this.notifier.sendLiquidationStartAlert(event.args.agentVault);
                } else if (eventIs(event, this.context.assetManager, 'LiquidationPerformed')) {
                    this.notifier.sendLiquidationWasPerformed(event.args.agentVault);
                } else if (eventIs(event, this.context.assetManager, "UnderlyingFreeBalanceNegative")) {
                    this.notifier.sendFullLiquidationAlert(event.args.agentVault);
                } else if (eventIs(event, this.context.assetManager, "DuplicatePaymentConfirmed")) {
                    this.notifier.sendFullLiquidationAlert(event.args.agentVault, event.args.transactionHash1, event.args.transactionHash2);
                } else if (eventIs(event, this.context.assetManager, "IllegalPaymentConfirmed")) {
                    this.notifier.sendFullLiquidationAlert(event.args.agentVault, event.args.transactionHash);
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
        }).catch(error => {
            console.error(`Error handling next minting step for minting ${id} agent ${this.agent.vaultAddress}`);
        });
    }

    async checkForNonPaymentProofOrExpiredProofs(minting: AgentMinting): Promise<void> {
        // corner case: proof expires in indexer
        const proof = await this.checkProofExpiredInIndexer(minting.lastUnderlyingBlock, minting.lastUnderlyingTimestamp);
        if (proof) {
            await this.context.assetManager.unstickMinting(proof, minting.requestId, { from: this.agent.ownerAddress });
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
        const proof = await this.context.attestationProvider.obtainReferencedPaymentNonexistenceProof(minting.proofRequestRound!, minting.proofRequestData!);
        if (!proof.finalized) return;
        if (proof.result && proof.result.merkleProof) {
            const nonPaymentProof = proof.result as ProvedDH<DHReferencedPaymentNonexistence>;
            await this.context.assetManager.mintingPaymentDefault(nonPaymentProof, minting.requestId, { from: this.agent.ownerAddress });
            minting.state = AgentMintingState.DONE;
        } else {
            this.notifier.sendNoProofObtained(minting.agentAddress, minting.requestId.toString(), minting.proofRequestRound!, minting.proofRequestData!);
        }
    }

    async checkPaymentAndExecuteMinting(minting: AgentMinting): Promise<void> {
        const proof = await this.context.attestationProvider.obtainPaymentProof(minting.proofRequestRound!, minting.proofRequestData!);
        if (!proof.finalized) return;
        if (proof.result && proof.result.merkleProof) {
            const paymentProof = proof.result as ProvedDH<DHPayment>;
            await this.context.assetManager.executeMinting(paymentProof, minting.requestId, { from: this.agent.ownerAddress });
            minting.state = AgentMintingState.DONE;
        } else {
            this.notifier.sendNoProofObtained(minting.agentAddress, minting.requestId.toString(), minting.proofRequestRound!, minting.proofRequestData!);
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

    async redemptionFinished(em: EM, request: EventArgs<RedemptionDefault>): Promise<void> {
        const redemption = await this.findRedemption(em, request.requestId);
        redemption.state = AgentRedemptionState.DONE;
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
        }).catch(error => {
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
            this.notifier.sendRedemptionCornerCase(redemption.requestId.toString());
        } else {
            const txBlock = await this.context.chain.getTransactionBlock(redemption.txHash!);
            const blockHeight = await this.context.chain.getBlockHeight();
            if (txBlock != null && blockHeight - txBlock.number >= this.context.chain.finalizationBlocks) {
                await this.requestPaymentProof(redemption);
            }
        }
    }

    async requestPaymentProof(redemption: AgentRedemption): Promise<void> {
        const request = await this.context.attestationProvider.requestPaymentProof(redemption.txHash!, this.agent.underlyingAddress, redemption.paymentAddress);
        redemption.state = AgentRedemptionState.REQUESTED_PROOF;
        redemption.proofRequestRound = request.round;
        redemption.proofRequestData = request.data;
    }

    async checkConfirmPayment(redemption: AgentRedemption): Promise<void> {
        const proof = await this.context.attestationProvider.obtainPaymentProof(redemption.proofRequestRound!, redemption.proofRequestData!);
        if (!proof.finalized) return;
        if (proof.result && proof.result.merkleProof) {
            const paymentProof = proof.result as ProvedDH<DHPayment>;
            await this.context.assetManager.confirmRedemptionPayment(paymentProof, redemption.requestId, { from: this.agent.ownerAddress });
            redemption.state = AgentRedemptionState.DONE;
        } else {
            this.notifier.sendNoProofObtained(redemption.agentAddress, redemption.requestId.toString(), redemption.proofRequestRound!, redemption.proofRequestData!, true);
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

    async handleAgentDestruction(em: EM, args: EventArgs<AgentDestroyed>): Promise<void> {
        const agentBotEnt = await em.findOneOrFail(AgentEntity, { vaultAddress: args.agentVault } as FilterQuery<AgentEntity>);
        agentBotEnt.active = false;
    }

    async checkUnderlyingBalance(agentVault: string): Promise<void> {
        const freeUnderlyingBalance = toBN((await this.agent.getAgentInfo()).freeUnderlyingBalanceUBA);
        const estimatedFee = toBN(await this.context.chain.getTransactionFee());
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
        const estimatedFee = toBN(await this.context.chain.getTransactionFee());
        if (ownerUnderlyingBalance.lte(estimatedFee.muln(NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR))) {
            this.notifier.sendLowBalanceOnUnderlyingOwnersAddress(ownerUnderlyingAddress, ownerUnderlyingBalance.toString());
        }
    }

    // owner deposits flr/sgb to vault to get out of ccb or liquidation due to price changes
    async checkAgentForCollateralRatioAndTopUp(): Promise<void> {
        const agentInfo = await this.agent.getAgentInfo();
        const settings = await this.context.assetManager.getSettings();
        const requiredCrBIPS = toBN(settings.minCollateralRatioBIPS).muln(CCB_LIQUIDATION_PREVENTION_FACTOR);
        const requiredTopUp = await this.requiredTopUp(requiredCrBIPS, agentInfo, settings);
        if (requiredTopUp.lte(BN_ZERO)) {
            // no need for top up
            return;
        }
        try {
            await this.agent.depositCollateral(requiredTopUp);
            this.notifier.sendCollateralTopUpAlert(this.agent.vaultAddress, requiredTopUp.toString());
        } catch (err) {
            this.notifier.sendCollateralTopUpFailedAlert(this.agent.vaultAddress, requiredTopUp.toString());
        }
        const ownerBalance = toBN(await web3.eth.getBalance(this.agent.ownerAddress));
        if (ownerBalance.lte(NATIVE_LOW_BALANCE)) {
            this.notifier.sendLowBalanceOnOwnersAddress(this.agent.ownerAddress, ownerBalance.toString());
        }
    }

    async requiredTopUp(requiredCrBIPS: BN, agentInfo: AgentInfo, settings: AssetManagerSettings): Promise<BN> {
        const collateral = await this.context.wnat.balanceOf(this.agent.agentVault.address);
        const [amgToNATWeiPrice, amgToNATWeiPriceTrusted] = await this.currentAmgToNATWeiPriceWithTrusted(settings);
        const amgToNATWei = BN.min(amgToNATWeiPrice, amgToNATWeiPriceTrusted);
        const totalUBA = toBN(agentInfo.mintedUBA).add(toBN(agentInfo.reservedUBA)).add(toBN(agentInfo.redeemingUBA));
        const backingNATWei = convertUBAToNATWei(settings, totalUBA, amgToNATWei);
        const requiredCollateral = backingNATWei.mul(requiredCrBIPS).divn(MAX_BIPS);
        return requiredCollateral.sub(collateral);
    }

    private async currentAmgToNATWeiPriceWithTrusted(settings: AssetManagerSettings): Promise<[ftsoPrice: BN, trustedPrice: BN]> {
        const prices = (await this.currentPriceWithTrusted())[0];
        const trustedPrices = (await this.currentPriceWithTrusted())[1];
        const ftsoPrice = amgToNATWeiPrice(settings, prices.natPrice, prices.assetPrice);
        const trustedPrice = trustedPrices.natTimestampTrusted.add(toBN(settings.maxTrustedPriceAgeSeconds)).gte(prices.natTimestamp) &&
            trustedPrices.assetTimestampTrusted.add(toBN(settings.maxTrustedPriceAgeSeconds)).gte(prices.assetTimestamp) ?
            amgToNATWeiPrice(settings, trustedPrices.natPriceTrusted, trustedPrices.assetPriceTrusted) : ftsoPrice;
        return [ftsoPrice, trustedPrice];
    }

    private async currentPriceWithTrusted(): Promise<[{ natPrice: BN, natTimestamp: BN, assetPrice: BN, assetTimestamp: BN }, { natPriceTrusted: BN, natTimestampTrusted: BN, assetPriceTrusted: BN, assetTimestampTrusted: BN }]> {
        const { 0: natPrice, 1: natTimestamp } = await this.context.natFtso.getCurrentPrice();
        const { 0: assetPrice, 1: assetTimestamp } = await this.context.assetFtso.getCurrentPrice();
        const { 0: natPriceTrusted, 1: natTimestampTrusted } = await this.context.natFtso.getCurrentPriceFromTrustedProviders();
        const { 0: assetPriceTrusted, 1: assetTimestampTrusted } = await this.context.assetFtso.getCurrentPriceFromTrustedProviders();
        return [{ natPrice: natPrice, natTimestamp: natTimestamp, assetPrice: assetPrice, assetTimestamp: assetTimestamp },
        { natPriceTrusted: natPriceTrusted, natTimestampTrusted: natTimestampTrusted, assetPriceTrusted: assetPriceTrusted, assetTimestampTrusted: assetTimestampTrusted }];
    }
}
