import { RedemptionRequested } from "../../typechain-truffle/AssetManager";
import { IAssetContext } from "../fasset/IAssetContext";
import { DI } from "../run-agent";
import { ProvedDH } from "../underlying-chain/AttestationHelper";
import { artifacts } from "../utils/artifacts";
import { EventArgs } from "../utils/events/common";
import { fail, toBN } from "../utils/helpers";
import { DHPayment } from "../verification/generated/attestation-hash-types";
import { Agent } from "./Agent";
import { AgentEntity, Redemption } from "./entities";

const AgentVault = artifacts.require('AgentVault');

export class PersistentAgent {
    constructor(
        public agent: Agent
    ) { }

    context = this.agent.context;

    static async create(context: IAssetContext, ownerAddress: string) {
        const underlyingAddress = await context.wallet.createAccount();
        await context.wallet.saveAccounts(`${DI.config.walletsPath}/wallet-${context.chainInfo.chainId}.json`);
        // TODO: add EOA proof when needed
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        const agentEntity = new AgentEntity();
        agentEntity.chainId = context.chainInfo.chainId;
        agentEntity.ownerAddress = agent.ownerAddress;
        agentEntity.vaultAddress = agent.agentVault.address;
        agentEntity.underlyingAddress = agent.underlyingAddress;
        agentEntity.active = true;
        DI.em.persist(agentEntity);
        return new PersistentAgent(agent);
    }

    static async load(contextMap: Map<number, IAssetContext>, agentEntity: AgentEntity) {
        const context = contextMap.get(agentEntity.chainId) ?? fail("Invalid chain id");
        const agentVault = await AgentVault.at(agentEntity.vaultAddress);
        const agent = new Agent(context, agentEntity.ownerAddress, agentVault, agentEntity.underlyingAddress);
        return new PersistentAgent(agent);
    }

    startRedemption(request: EventArgs<RedemptionRequested>) {
        const redemption = new Redemption();
        redemption.state = 'start';
        redemption.agentAddress = this.agent.agentVault.address;
        redemption.requestId = toBN(request.requestId);
        redemption.paymentAddress = request.paymentAddress;
        redemption.valueUBA = toBN(request.valueUBA);
        redemption.feeUBA = toBN(request.feeUBA);
        redemption.paymentReference = request.paymentReference;
        DI.em.persist(redemption);
    }

    async nextRedemptionStep(redemption: Redemption) {
        // TODO: what id there is error during payment (state=start) - check!!!
        if (redemption.state === 'paid') {
            await this.checkPaymentProofAvailable(redemption);
        } else if (redemption.state === 'requestedProof') {
            await this.checkConfirmPayment(redemption);
        }
    }

    async payForRedemption(id: BN) {
        const redemption = await DI.em.getRepository(Redemption).findOneOrFail({ id: Number(id) });
        const paymentAmount = redemption.valueUBA.sub(redemption.feeUBA);
        // !!! TODO: what if there are too little funds on underlying address to pay for fee?
        const txHash = await this.agent.performPayment(redemption.paymentAddress, paymentAmount, redemption.paymentReference);
        redemption.txHash = txHash;
        // this.saveRedemption(redemption);
    }

    async checkPaymentProofAvailable(redemption: Redemption) {
        const txBlock = await this.context.chain.getTransactionBlock(redemption.txHash!);
        const blockHeight = await this.context.chain.getBlockHeight();
        if (txBlock != null && blockHeight - txBlock.number >= this.context.chain.finalizationBlocks) {
            await this.requestPaymentProof(redemption);
        }
    }

    async requestPaymentProof(redemption: Redemption) {
        const request = await this.context.attestationProvider.requestPaymentProof(redemption.txHash!, this.agent.underlyingAddress, redemption.paymentAddress);
        redemption.state = 'requestedProof';
        redemption.proofRequestRound = request.round;
        redemption.proofRequestData = request.data;
        // this.saveRedemption(redemption);
    }

    async checkConfirmPayment(redemption: Redemption) {
        const proof = await this.context.attestationProvider.obtainPaymentProof(redemption.proofRequestRound!, redemption.proofRequestData!);
        if (!proof.finalized) return;
        if (proof.result && proof.result.merkleProof) {
            const paymentProof = proof.result as ProvedDH<DHPayment>;
            await this.context.assetManager.confirmRedemptionPayment(paymentProof, redemption.requestId, { from: this.agent.ownerAddress });
            redemption.state = 'done';
            // this.saveRedemption(redemption);
        } else {
            // TODO: payment happened but we cannot obtain proof... retry or alert?!!
        }
    }

}
