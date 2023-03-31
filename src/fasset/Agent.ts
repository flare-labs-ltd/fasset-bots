import { AgentVaultInstance, CollateralPoolInstance, CollateralPoolTokenInstance } from "../../typechain-truffle";
import { AllEvents, AssetManagerInstance, CollateralReserved, RedemptionDefault, RedemptionFinished, RedemptionPaymentFailed, RedemptionRequested, UnderlyingWithdrawalAnnounced } from "../../typechain-truffle/AssetManager";
import { artifacts } from "../utils/artifacts";
import { checkEventNotEmitted, ContractWithEvents, eventArgs, findRequiredEvent, requiredEventArgs } from "../utils/events/truffle";
import { BNish, requireNotNull, toBN } from "../utils/helpers";
import { AgentInfo, AgentSettings, AssetManagerSettings } from "./AssetManagerTypes";
import { IAssetContext } from "./IAssetContext";
import { PaymentReference } from "./PaymentReference";
import { web3DeepNormalize } from "../utils/web3normalize";
import { EventArgs } from "../utils/events/common";
import { IBlockChainWallet, TransactionOptionsWithFee } from "../underlying-chain/interfaces/IBlockChainWallet";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";

const AgentVault = artifacts.require('AgentVault');
const CollateralPool = artifacts.require('CollateralPool');
const CollateralPoolToken = artifacts.require('CollateralPoolToken');

export class Agent {
    constructor(
        public context: IAssetContext,
        public ownerAddress: string,
        public agentVault: AgentVaultInstance,
        public collateralPool: CollateralPoolInstance,
        public collateralPoolToken: CollateralPoolTokenInstance,
        public agentSettings: AgentSettings
    ) {
    }

    get assetManager(): ContractWithEvents<AssetManagerInstance, AllEvents> {
        return this.context.assetManager;
    }

    get attestationProvider(): AttestationHelper {
        return this.context.attestationProvider;
    }

    get vaultAddress(): string {
        return this.agentVault.address;
    }

    get wallet(): IBlockChainWallet {
        return this.context.wallet;
    }

    get underlyingAddress(): string {
        return this.agentSettings.underlyingAddressString;
    }

    async getAssetManagerSettings(): Promise<AssetManagerSettings> {
        return await this.context.assetManager.getSettings();
    }

    class1Token = requireNotNull(Object.values(this.context.stablecoins).find(token => token.address === this.agentSettings.class1CollateralToken));

    static async create(ctx: IAssetContext, ownerAddress: string, agentSettings: AgentSettings): Promise<Agent> {
        // create agent
        const response = await ctx.assetManager.createAgent(web3DeepNormalize(agentSettings), { from: ownerAddress });
        // extract agent vault address from AgentCreated event
        const event = findRequiredEvent(response, 'AgentCreated');
        // get vault contract at agent's vault address address
        const agentVault = await AgentVault.at(event.args.agentVault);
        // get collateral pool
        const collateralPool = await CollateralPool.at(event.args.collateralPool);
        // get pool token
        const poolTokenAddress = await collateralPool.poolToken();
        const collateralPoolToken = await CollateralPoolToken.at(poolTokenAddress);
        // create object
        return new Agent(ctx, ownerAddress, agentVault, collateralPool, collateralPoolToken, agentSettings);
    }

    async depositClass1Collateral(amountTokenWei: BNish) {
        return await this.agentVault.depositCollateral(this.class1Token.address, amountTokenWei, { from: this.ownerAddress });
    }

    // adds pool collateral and agent pool tokens
    async buyCollateralPoolTokens(amountNatWei: BNish) {
        return await this.agentVault.buyCollateralPoolTokens({ from: this.ownerAddress, value: toBN(amountNatWei) });
    }

    async makeAvailable() {
        const res = await this.assetManager.makeAgentAvailable(this.vaultAddress, { from: this.ownerAddress });
        return requiredEventArgs(res, 'AgentAvailable');
    }

    async depositCollateralsAndMakeAvailable(class1Collateral: BNish, poolCollateral: BNish) {
        await this.depositClass1Collateral(class1Collateral);
        await this.buyCollateralPoolTokens(poolCollateral);
        await this.makeAvailable();
    }

    async announceExitAvailable(): Promise<BN> {
        const res = await this.assetManager.announceExitAvailableAgentList(this.vaultAddress, { from: this.ownerAddress });
        const args = requiredEventArgs(res, 'AvailableAgentExitAnnounced');
        return args.exitAllowedAt;
    }

    async exitAvailable() {
        const res = await this.assetManager.exitAvailableAgentList(this.vaultAddress, { from: this.ownerAddress });
        return requiredEventArgs(res, 'AvailableAgentExited');
    }

    async announceClass1CollateralWithdrawal(amountWei: BNish): Promise<BN> {
        const res = await this.assetManager.announceClass1CollateralWithdrawal(this.vaultAddress, amountWei, { from: this.ownerAddress });
        const args = requiredEventArgs(res, 'Class1WithdrawalAnnounced');
        return args.withdrawalAllowedAt;
    }

    async withdrawClass1Collateral(amountWei: BNish) {
        return await this.agentVault.withdrawCollateral(this.class1Token.address, amountWei, this.ownerAddress, { from: this.ownerAddress });
    }

    async poolTokenBalance() {
        return await this.collateralPoolToken.balanceOf(this.vaultAddress);
    }

    async announcePoolTokenRedemption(amountWei: BNish) {
        const res = await this.assetManager.announceAgentPoolTokenRedemption(this.vaultAddress, amountWei, { from: this.ownerAddress });
        const args = requiredEventArgs(res, 'PoolTokenRedemptionAnnounced');
        return args;
    }

    async redeemCollateralPoolTokens(amountWei: BNish, recipient: string = this.ownerAddress) {
        return await this.agentVault.redeemCollateralPoolTokens(amountWei, recipient, { from: this.ownerAddress });
    }

    async withdrawPoolFees(amountUBA: BNish, recipient: string = this.ownerAddress) {
        await this.agentVault.withdrawPoolFees(amountUBA, recipient, { from: this.ownerAddress });
    }

    async poolFeeBalance() {
        return await this.collateralPool.freeFassetOf(this.vaultAddress);
    }

    async announceDestroy(): Promise<BN> {
        const res = await this.assetManager.announceDestroyAgent(this.vaultAddress, { from: this.ownerAddress });
        const args = requiredEventArgs(res, 'AgentDestroyAnnounced');
        return args.destroyAllowedAt;
    }

    async destroy(recipient: string = this.ownerAddress) {
        const res = await this.assetManager.destroyAgent(this.vaultAddress, recipient, { from: this.ownerAddress });
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

    async performUnderlyingWithdrawal(request: EventArgs<UnderlyingWithdrawalAnnounced>, amount: BNish, underlyingAddress: string): Promise<string> {
        return await this.wallet.addTransaction(this.underlyingAddress, underlyingAddress, amount, request.paymentReference);
    }

    async confirmUnderlyingWithdrawal(request: EventArgs<UnderlyingWithdrawalAnnounced>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, null);
        const res = await this.assetManager.confirmUnderlyingWithdrawal(proof, this.agentVault.address, { from: this.ownerAddress });
        return requiredEventArgs(res, 'UnderlyingWithdrawalConfirmed');
    }

    async cancelUnderlyingWithdrawal() {
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
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-non-null-asserted-optional-chain
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

    async announceAgentSettingUpdate(settingName: string, settingValue: string): Promise<BN> {
        const res = await this.assetManager.announceAgentSettingUpdate(this.vaultAddress, settingName, settingValue, { from: this.ownerAddress });
        const args = requiredEventArgs(res, 'AgentSettingChangeAnnounced');
        return args.validAt;
    }

    async executeAgentSettingUpdate(settingName: string): Promise<void> {
        await this.assetManager.executeAgentSettingUpdate(this.vaultAddress, settingName, { from: this.ownerAddress });
    }

}
