import { RedemptionRequested } from "../../typechain-truffle/AssetManager";
import { ProvedDH } from "../underlying-chain/AttestationHelper";
import { EventArgs } from "../utils/events/common";
import { toBN } from "../utils/helpers";
import { DHPayment } from "../verification/generated/attestation-hash-types";
import { Agent } from "./Agent";

export class PersistentAgent {
    constructor(
        public agent: Agent
    ) { }
    
    context = this.agent.context;
    
    startRedemption(request: EventArgs<RedemptionRequested>) {
        const redemption: Redemption = {
            state: 'start',
            agentAddress: request.agentVault,
            requestId: toBN(request.requestId),
            paymentAddress: request.paymentAddress,
            valueUBA: toBN(request.valueUBA),
            feeUBA: toBN(request.feeUBA),
            paymentReference: request.paymentReference,
        };
        this.saveRedemption(redemption);
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
        const redemption = this.loadRedemption(id);
        const paymentAmount = redemption.valueUBA.sub(redemption.feeUBA);
        // !!! TODO: what if there are too little funds on underlying address to pay for fee?
        const txHash = await this.agent.performPayment(redemption.paymentAddress, paymentAmount, redemption.paymentReference);
        redemption.txHash = txHash;
        this.saveRedemption(redemption);
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
        this.saveRedemption(redemption);
    }
    
    async checkConfirmPayment(redemption: Redemption) {
        const finalized = await this.context.attestationProvider.roundFinalized(redemption.proofRequestRound!);
        if (finalized) {
            const proof = await this.context.attestationProvider.obtainPaymentProof(redemption.proofRequestRound!, redemption.proofRequestData!);
            if (proof.finalized && proof.result) {
                const paymentProof = proof.result as ProvedDH<DHPayment>;
                await this.context.assetManager.confirmRedemptionPayment(paymentProof, redemption.requestId, { from: this.agent.ownerAddress });
                redemption.state = 'done';
                this.saveRedemption(redemption);
            }
        }
    }
    
    loadRedemption(id: BN): Redemption {
        throw new Error("Method not implemented.");
    }
    
    saveRedemption(redemption: Redemption) {
        throw new Error("Method not implemented.");
    }
}

export interface Redemption {
    state: 'start' | 'paid' | 'requestedProof' | 'done';
    // status: 'active' | 'defaulted'
    // 'start' state data
    agentAddress: string;
    requestId: BN;
    paymentAddress: string;
    valueUBA: BN;
    feeUBA: BN;
    paymentReference: string;
    // 'paid' state data
    txHash?: string;
    paymentBlock?: number;
    // 'requestedProof' state data
    proofRequestRound?: number;
    proofRequestData?: string;
    // 'confirmed' state data
}
