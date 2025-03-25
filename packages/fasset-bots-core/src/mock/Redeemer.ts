import { ReferencedPaymentNonexistence } from "@flarenetwork/state-connector-protocol";
import BN from "bn.js";
import { assert } from "chai";
import { CoreVaultRedemptionRequested, DustChanged, RedemptionDefault, RedemptionRequested } from "../../typechain-truffle/IIAssetManager";
import { IAssetAgentContext } from "../fasset-bots/IAssetBotContext";
import { Agent } from "../fasset/Agent";
import { EventArgs } from "../utils/events/common";
import { eventArgs, filterEvents, requiredEventArgs } from "../utils/events/truffle";
import { BN_ZERO, BNish, ZERO_ADDRESS, requireNotNull, toBN } from "../utils/helpers";
import { web3DeepNormalize } from "../utils/web3normalize";

export class Redeemer {
    static deepCopyWithObjectCreate = true;

    constructor(
        public context: IAssetAgentContext,
        public address: string,
        public underlyingAddress: string
    ) {
    }

    get assetManager() {
        return this.context.assetManager;
    }

    get attestationProvider() {
        return this.context.attestationProvider;
    }

    static async create(ctx: IAssetAgentContext, address: string, underlyingAddress: string): Promise<Redeemer> {
        return new Redeemer(ctx, address, underlyingAddress);
    }

    async requestRedemption(lots: BNish, executorAddress?: string, executorFeeNatWei?: BNish): Promise<[requests: EventArgs<RedemptionRequested>[], remainingLots: BN, dustChanges: EventArgs<DustChanged>[]]> {
        const executor = executorAddress ? executorAddress : ZERO_ADDRESS;
        const executorFee = executor != ZERO_ADDRESS ? toBN(requireNotNull(executorFeeNatWei, "executor fee required if executor used")) : undefined;
        const res = await this.assetManager.redeem(lots, this.underlyingAddress, executor, { from: this.address, value: executorFee });
        const redemptionRequests = filterEvents(res, 'RedemptionRequested').map(e => e.args);
        const redemptionIncomplete = eventArgs(res, 'RedemptionRequestIncomplete');
        const dustChangedEvents = filterEvents(res, 'DustChanged').map(e => e.args);
        const remainingLots = redemptionIncomplete?.remainingLots ?? BN_ZERO;
        return [redemptionRequests, remainingLots, dustChangedEvents];
    }

    async convertDustToTicket(agent: Agent): Promise<BN> {
        const res = await this.assetManager.convertDustToTicket(agent.agentVault.address);
        const dustChangedEvent = requiredEventArgs(res, 'DustChanged');
        assert.equal(dustChangedEvent.agentVault, agent.agentVault.address);
        return dustChangedEvent.dustUBA;
    }

    async redemptionPaymentDefault(request: EventArgs<RedemptionRequested>): Promise<EventArgs<RedemptionDefault>> {
        const proof = await this.attestationProvider.proveReferencedPaymentNonexistence(
            request.paymentAddress,
            request.paymentReference,
            request.valueUBA.sub(request.feeUBA),
            request.firstUnderlyingBlock.toNumber(),
            request.lastUnderlyingBlock.toNumber(),
            request.lastUnderlyingTimestamp.toNumber());
        return this.executePaymentDefault(request.requestId, proof, request.executor);
    }

    async requestNonPaymentProof(paymentAddress: string, paymentReference: string, amountUBA: BNish, firstUnderlyingBlock: BNish, lastUnderlyingBlock: BNish, lastUnderlyingTimestamp: BNish) {
        return await this.attestationProvider.requestReferencedPaymentNonexistenceProof(
            paymentAddress,
            paymentReference,
            toBN(amountUBA),
            Number(firstUnderlyingBlock),
            Number(lastUnderlyingBlock),
            Number(lastUnderlyingTimestamp));
    }

    async obtainNonPaymentProof(roundId: number, requestData: string) {
        return await this.context.attestationProvider.obtainReferencedPaymentNonexistenceProof(roundId, requestData);
    }

    async proveNonPayment(paymentAddress: string, paymentReference: string, amountUBA: BNish, firstUnderlyingBlock: BNish, lastUnderlyingBlock: BNish, lastUnderlyingTimestamp: BNish) {
        return await this.attestationProvider.proveReferencedPaymentNonexistence(
            paymentAddress,
            paymentReference,
            toBN(amountUBA),
            Number(firstUnderlyingBlock),
            Number(lastUnderlyingBlock),
            Number(lastUnderlyingTimestamp));
    }

    async executePaymentDefault(requestId: BNish, proof: ReferencedPaymentNonexistence.Proof, executorAddress: string) {
        const executor = executorAddress !== ZERO_ADDRESS ? executorAddress : this.address;
        const res = await this.assetManager.redemptionPaymentDefault(web3DeepNormalize(proof), requestId, { from: executor });
        return requiredEventArgs(res, 'RedemptionDefault');
    }

    async executeRejectedPaymentDefault(requestId: BNish, executorAddress: string) {
        const executor = executorAddress !== ZERO_ADDRESS ? executorAddress : this.address;
        const res = await this.assetManager.rejectedRedemptionPaymentDefault(requestId, { from: executor });
        return requiredEventArgs(res, 'RedemptionDefault');
    }

    async requestRedemptionFromCoreVault(lots: BNish): Promise<EventArgs<CoreVaultRedemptionRequested>[]> {
        const res = await this.assetManager.redeemFromCoreVault(lots, this.underlyingAddress, { from: this.address });
        const redemptionRequest = filterEvents(res, 'CoreVaultRedemptionRequested').map(e => e.args);
        return redemptionRequest;
    }
}
