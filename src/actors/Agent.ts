import { AgentVaultInstance } from "../../typechain-truffle";
import { CollateralReserved, RedemptionDefault, RedemptionFinished, RedemptionPaymentFailed, RedemptionRequested, UnderlyingWithdrawalAnnounced } from "../../typechain-truffle/AssetManager";
import { IAssetContext } from "../fasset/IAssetContext";
import { PaymentReference } from "../fasset/PaymentReference";
import { IBlockChainWallet, TransactionOptionsWithFee } from "../underlying-chain/interfaces/IBlockChainWallet";
import { artifacts } from "../utils/artifacts";
import { EventArgs } from "../utils/events/common";
import { checkEventNotEmited, eventArgs, findRequiredEvent, requiredEventArgs } from "../utils/events/truffle";
import { BNish, toBN } from "../utils/helpers";

const AgentVault = artifacts.require('AgentVault');

export class Agent {
    constructor(
        public context: IAssetContext,
        public ownerAddress: string,
        public agentVault: AgentVaultInstance,
        public underlyingAddress: string,
        public wallet: IBlockChainWallet,
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
    
    // static async createTest(ctx: AssetContext, ownerAddress: string, underlyingAddress: string) {
    //     if (!(ctx.chain instanceof MockChain)) assert.fail("only for mock chains");
    //     // mint some funds on underlying address (just enough to make EOA proof)
    //     if (ctx.chainInfo.requireEOAProof) {
    //         ctx.chain.mint(underlyingAddress, ctx.chain.requiredFee.addn(1));
    //     }
    //     // create mock wallet
    //     const wallet = new MockChainWallet(ctx.chain);
    //     return await Agent.create(ctx, ownerAddress, underlyingAddress, wallet);
    // }
    
    static async create(ctx: IAssetContext, ownerAddress: string, underlyingAddress: string, wallet: IBlockChainWallet) {
        // create and prove transaction from underlyingAddress if EOA required
        if (ctx.chainInfo.requireEOAProof) {
            const txHash = await wallet.addTransaction(underlyingAddress, underlyingAddress, 1, PaymentReference.addressOwnership(ownerAddress));
            if (ctx.chain.finalizationBlocks > 0) {
                await ctx.chainEvents.waitForUnderlyingTransactionFinalization(undefined, txHash);
            }
            const proof = await ctx.attestationProvider.provePayment(txHash, underlyingAddress, underlyingAddress);
            await ctx.assetManager.proveUnderlyingAddressEOA(proof, { from: ownerAddress });
        }
        // create agent
        const response = await ctx.assetManager.createAgent(underlyingAddress, { from: ownerAddress });
        // extract agent vault address from AgentCreated event
        const event = findRequiredEvent(response, 'AgentCreated');
        // get vault contract at agent's vault address address
        const agentVault = await AgentVault.at(event.args.agentVault);
        // create object
        return new Agent(ctx, ownerAddress, agentVault, underlyingAddress, wallet);
    }
    
    async depositCollateral(amountNATWei: BNish) {
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

    // async exitAndDestroy(collateral: BNish) {
    //     await this.exitAvailable();
    //     await this.announceDestroy();
    //     await time.increase(300);
    //     return await this.destroy();
    // }
    
    async announceCollateralWithdrawal(amountNATWei: BNish) {
        await this.assetManager.announceCollateralWithdrawal(this.vaultAddress, amountNATWei, { from: this.ownerAddress });
    }

    async withdrawCollateral(amountNATWei: BNish) {
        return await this.agentVault.withdraw(amountNATWei, { from: this.ownerAddress });
    }

    async announceDestroy() {
        await this.assetManager.announceDestroyAgent(this.vaultAddress, { from: this.ownerAddress });
    }
    
    async destroy() {
        const res = await this.assetManager.destroyAgent(this.vaultAddress, { from: this.ownerAddress });
        return requiredEventArgs(res, 'AgentDestroyed');
    }

    async performTopupPayment(amount: BNish, underlyingAddress: string) {
        return await this.wallet.addTransaction(underlyingAddress, this.underlyingAddress, amount, PaymentReference.topup(this.agentVault.address));
    }

    async confirmTopupPayment(transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, null, this.underlyingAddress);
        await this.assetManager.confirmTopupPayment(proof, this.agentVault.address, { from: this.ownerAddress });
    }

    async announceUnderlyingWithdrawal() {
        const res = await this.assetManager.announceUnderlyingWithdrawal(this.agentVault.address, { from: this.ownerAddress });
        return requiredEventArgs(res, 'UnderlyingWithdrawalAnnounced');
    }

    async performUnderlyingWithdrawal(request: EventArgs<UnderlyingWithdrawalAnnounced>, amount: BNish, underlyingAddress: string = "someAddress") {
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
    
    async performRedemptionPayment(request: EventArgs<RedemptionRequested>, options?: TransactionOptionsWithFee) {
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
        checkEventNotEmited(res, 'RedemptionPerformed');
        checkEventNotEmited(res, 'RedemptionPaymentFailed');
        checkEventNotEmited(res, 'RedemptionPaymentBlocked');
    }

    async confirmFailedRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string): Promise<[redemptionPaymentFailed: EventArgs<RedemptionPaymentFailed>, redemptionDefault: EventArgs<RedemptionDefault>]>  {
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

    async unstickMinting(crt: EventArgs<CollateralReserved>) {
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

    async performPayment(paymentAddress: string, paymentAmount: BNish, paymentReference: string | null = null, options?: TransactionOptionsWithFee) {
        return this.wallet.addTransaction(this.underlyingAddress, paymentAddress, paymentAmount, paymentReference, options);
    }

    async endLiquidation() {
        const res = await this.assetManager.endLiquidation(this.vaultAddress, { from: this.ownerAddress });
        return eventArgs(res, 'LiquidationEnded');
    }

    async buybackAgentCollateral() {
        await this.assetManager.buybackAgentCollateral(this.agentVault.address, { from: this.ownerAddress });
    }

    async getAgentInfo() {
        return await this.context.assetManager.getAgentInfo(this.agentVault.address);
    }
}
