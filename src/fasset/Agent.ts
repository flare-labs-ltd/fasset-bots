import { AgentVaultInstance } from "../../typechain-truffle";
import { CollateralReserved, RedemptionDefault, RedemptionFinished, RedemptionPaymentFailed, RedemptionRequested, UnderlyingWithdrawalAnnounced } from "../../typechain-truffle/AssetManager";
import { TransactionOptionsWithFee } from "../underlying-chain/interfaces/IBlockChainWallet";
import { artifacts } from "../utils/artifacts";
import { EventArgs } from "../utils/events/common";
import { checkEventNotEmitted, eventArgs, findRequiredEvent, requiredEventArgs } from "../utils/events/truffle";
import { BNish, toBN } from "../utils/helpers";
import { AgentInfo } from "./AssetManagerTypes";
import { IAssetContext } from "./IAssetContext";
import { PaymentReference } from "./PaymentReference";

const AgentVault = artifacts.require('AgentVault');

export class Agent {
    constructor(
        public context: IAssetContext,
        public ownerAddress: string,
        public agentVault: AgentVaultInstance,
        public underlyingAddress: string
    ) {
    }

    get assetManager() {
        return this.context.assetManager;
    }

    get attestationProvider() {
        return this.context.attestationProvider;
    }

    get vaultAddress() {
        return this.agentVault.address;
    }

    get wallet() {
        return this.context.wallet;
    }

    static async create(ctx: IAssetContext, ownerAddress: string, underlyingAddress: string): Promise<Agent> {
        // create agent
        const response = await ctx.assetManager.createAgent(underlyingAddress, { from: ownerAddress });
        // extract agent vault address from AgentCreated event
        const event = findRequiredEvent(response, 'AgentCreated');
        // get vault contract at agent's vault address address
        const agentVault = await AgentVault.at(event.args.agentVault);
        // create object
        return new Agent(ctx, ownerAddress, agentVault, underlyingAddress);
    }

    async depositCollateral(amountNATWei: BNish): Promise<void> {
        await this.agentVault.deposit({ from: this.ownerAddress, value: toBN(amountNATWei) });
    }

    async makeAvailable(feeBIPS: BNish, collateralRatioBIPS: BNish) {
        const res = await this.assetManager.makeAgentAvailable(this.vaultAddress, feeBIPS, collateralRatioBIPS, { from: this.ownerAddress });
        return requiredEventArgs(res, 'AgentAvailable');
    }

    async exitAvailable() {
        const res = await this.assetManager.exitAvailableAgentList(this.vaultAddress, { from: this.ownerAddress });
        return requiredEventArgs(res, 'AvailableAgentExited');
    }

    async announceCollateralWithdrawal(amountNATWei: BNish): Promise<void> {
        await this.assetManager.announceCollateralWithdrawal(this.vaultAddress, amountNATWei, { from: this.ownerAddress });
    }

    async withdrawCollateral(amountNATWei: BNish) {
        return await this.agentVault.withdraw(amountNATWei, { from: this.ownerAddress });
    }

    async announceDestroy(): Promise<void> {
        await this.assetManager.announceDestroyAgent(this.vaultAddress, { from: this.ownerAddress });
    }

    async destroy() {
        const res = await this.assetManager.destroyAgent(this.vaultAddress, { from: this.ownerAddress });
        return requiredEventArgs(res, 'AgentDestroyed');
    }

    async performTopupPayment(amount: BNish, underlyingAddress: string): Promise<string> {
        return await this.wallet.addTransaction(underlyingAddress, this.underlyingAddress, amount, PaymentReference.topup(this.agentVault.address));
    }

    async confirmTopupPayment(transactionHash: string): Promise<void> {
        const proof = await this.attestationProvider.provePayment(transactionHash, null, this.underlyingAddress);
        await this.assetManager.confirmTopupPayment(proof, this.agentVault.address, { from: this.ownerAddress });
    }

    async announceUnderlyingWithdrawal() {
        const res = await this.assetManager.announceUnderlyingWithdrawal(this.agentVault.address, { from: this.ownerAddress });
        return requiredEventArgs(res, 'UnderlyingWithdrawalAnnounced');
    }

    async performUnderlyingWithdrawal(request: EventArgs<UnderlyingWithdrawalAnnounced>, amount: BNish, underlyingAddress: string = "someAddress"): Promise<string> {
        return await this.wallet.addTransaction(this.underlyingAddress, underlyingAddress, amount, request.paymentReference);
    }

    async confirmUnderlyingWithdrawal(request: EventArgs<UnderlyingWithdrawalAnnounced>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, null);
        const res = await this.assetManager.confirmUnderlyingWithdrawal(proof, this.agentVault.address, { from: this.ownerAddress });
        return requiredEventArgs(res, 'UnderlyingWithdrawalConfirmed');
    }

    async cancelUnderlyingWithdrawal(request: EventArgs<UnderlyingWithdrawalAnnounced>) {
        const res = await this.assetManager.cancelUnderlyingWithdrawal(this.agentVault.address, { from: this.ownerAddress });
        return requiredEventArgs(res, 'UnderlyingWithdrawalCancelled');
    }

    async performRedemptionPayment(request: EventArgs<RedemptionRequested>, options?: TransactionOptionsWithFee): Promise<string> {
        const paymentAmount = request.valueUBA.sub(request.feeUBA);
        return await this.performPayment(request.paymentAddress, paymentAmount, request.paymentReference, options);
    }

    async confirmActiveRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerAddress });
        findRequiredEvent(res, 'RedemptionFinished');
        return requiredEventArgs(res, 'RedemptionPerformed');
    }

    async confirmDefaultedRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerAddress });
        findRequiredEvent(res, 'RedemptionFinished');
        checkEventNotEmitted(res, 'RedemptionPerformed');
        checkEventNotEmitted(res, 'RedemptionPaymentFailed');
        checkEventNotEmitted(res, 'RedemptionPaymentBlocked');
    }

    async confirmFailedRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string): Promise<[redemptionPaymentFailed: EventArgs<RedemptionPaymentFailed>, redemptionDefault: EventArgs<RedemptionDefault>]> {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerAddress });
        findRequiredEvent(res, 'RedemptionFinished');
        return [requiredEventArgs(res, 'RedemptionPaymentFailed'), requiredEventArgs(res, 'RedemptionDefault')];
    }

    async confirmBlockedRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerAddress });
        findRequiredEvent(res, 'RedemptionFinished');
        return requiredEventArgs(res, 'RedemptionPaymentBlocked');
    }

    async redemptionPaymentDefault(request: EventArgs<RedemptionRequested>) {
        const proof = await this.attestationProvider.proveReferencedPaymentNonexistence(
            request.paymentAddress,
            request.paymentReference,
            request.valueUBA.sub(request.feeUBA),
            request.lastUnderlyingBlock.toNumber(),
            request.lastUnderlyingTimestamp.toNumber());
        const res = await this.assetManager.redemptionPaymentDefault(proof, request.requestId, { from: this.ownerAddress });
        return requiredEventArgs(res, 'RedemptionDefault');
    }

    async finishRedemptionWithoutPayment(request: EventArgs<RedemptionRequested>): Promise<[redemptionFinished?: EventArgs<RedemptionFinished>, redemptionDefault?: EventArgs<RedemptionDefault>]> {
        const proof = await this.attestationProvider.proveConfirmedBlockHeightExists();
        const res = await this.assetManager.finishRedemptionWithoutPayment(proof, request.requestId, { from: this.ownerAddress });
        return [eventArgs(res, 'RedemptionFinished'), eventArgs(res, "RedemptionDefault")];
    }

    async executeMinting(crt: EventArgs<CollateralReserved>, transactionHash: string, minterSourceAddress?: string) {
        if (!minterSourceAddress) {
            const tx = await this.context.chain.getTransaction(transactionHash);
            minterSourceAddress = tx?.inputs[0][0]!;
        }
        const proof = await this.attestationProvider.provePayment(transactionHash, minterSourceAddress, this.underlyingAddress);
        const res = await this.assetManager.executeMinting(proof, crt.collateralReservationId, { from: this.ownerAddress });
        return requiredEventArgs(res, 'MintingExecuted');
    }

    async mintingPaymentDefault(crt: EventArgs<CollateralReserved>) {
        const proof = await this.attestationProvider.proveReferencedPaymentNonexistence(
            this.underlyingAddress,
            crt.paymentReference,
            crt.valueUBA.add(crt.feeUBA),
            crt.lastUnderlyingBlock.toNumber(),
            crt.lastUnderlyingTimestamp.toNumber());
        const res = await this.assetManager.mintingPaymentDefault(proof, crt.collateralReservationId, { from: this.ownerAddress });
        return requiredEventArgs(res, 'MintingPaymentDefault');
    }

    async unstickMinting(crt: EventArgs<CollateralReserved>): Promise<void> {
        const proof = await this.attestationProvider.proveConfirmedBlockHeightExists();
        await this.assetManager.unstickMinting(proof, crt.collateralReservationId, { from: this.ownerAddress });
    }

    async selfMint(underlyingSourceAddress: string, amountUBA: BNish, lots: BNish) {
        const transactionHash = await this.wallet.addTransaction(underlyingSourceAddress, this.underlyingAddress, amountUBA, PaymentReference.selfMint(this.agentVault.address));
        const proof = await this.attestationProvider.provePayment(transactionHash, null, this.underlyingAddress);
        const res = await this.assetManager.selfMint(proof, this.agentVault.address, lots, { from: this.ownerAddress });
        return requiredEventArgs(res, 'MintingExecuted');
    }

    async selfClose(amountUBA: BNish) {
        const res = await this.assetManager.selfClose(this.agentVault.address, amountUBA, { from: this.ownerAddress });
        return requiredEventArgs(res, 'SelfClose');
    }

    async performPayment(paymentAddress: string, paymentAmount: BNish, paymentReference: string | null = null, options?: TransactionOptionsWithFee): Promise<string> {
        return this.wallet.addTransaction(this.underlyingAddress, paymentAddress, paymentAmount, paymentReference, options);
    }

    async endLiquidation() {
        const res = await this.assetManager.endLiquidation(this.vaultAddress, { from: this.ownerAddress });
        return eventArgs(res, 'LiquidationEnded');
    }

    async buybackAgentCollateral(): Promise<void> {
        await this.assetManager.buybackAgentCollateral(this.agentVault.address, { from: this.ownerAddress });
    }

    async getAgentInfo(): Promise<AgentInfo> {
        return await this.context.assetManager.getAgentInfo(this.agentVault.address);
    }
}
