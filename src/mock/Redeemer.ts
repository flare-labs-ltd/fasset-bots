import { assert } from "chai";
import { DustChanged, RedemptionDefault, RedemptionRequested } from "../../typechain-truffle/AssetManager";
import { Agent } from "../fasset/Agent";
import { IAssetContext } from "../fasset/IAssetContext";
import { EventArgs } from "../utils/events/common";
import { eventArgs, filterEvents, requiredEventArgs } from "../utils/events/truffle";
import { BN_ZERO, BNish } from "../utils/helpers";

export class Redeemer {
    constructor(
        public context: IAssetContext,
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

    static async create(ctx: IAssetContext, address: string, underlyingAddress: string): Promise<Redeemer> {
        return new Redeemer(ctx, address, underlyingAddress);
    }

    async requestRedemption(lots: BNish): Promise<[requests: EventArgs<RedemptionRequested>[], remainingLots: BN, dustChanges: EventArgs<DustChanged>[]]> {
        const res = await this.assetManager.redeem(lots, this.underlyingAddress, { from: this.address });
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
        const res = await this.assetManager.redemptionPaymentDefault(proof, request.requestId, { from: this.address });
        return requiredEventArgs(res, 'RedemptionDefault');
    }
}
