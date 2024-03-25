import { AgentVaultInstance, CollateralPoolInstance, CollateralPoolTokenInstance } from "../../typechain-truffle";
import { AgentAvailable, AgentDestroyed, AllEvents, AssetManagerInstance, AvailableAgentExited, SelfClose, UnderlyingWithdrawalAnnounced, UnderlyingWithdrawalCancelled, UnderlyingWithdrawalConfirmed } from "../../typechain-truffle/AssetManager";
import { ContractWithEvents, findRequiredEvent, requiredEventArgs } from "../utils/events/truffle";
import { BNish, toBN } from "../utils/helpers";
import { AgentInfo, AgentSettings, CollateralClass, CollateralType } from "./AssetManagerTypes";
import { PaymentReference } from "./PaymentReference";
import { web3DeepNormalize } from "../utils/web3normalize";
import { EventArgs } from "../utils/events/common";
import { IBlockChainWallet, TransactionOptionsWithFee } from "../underlying-chain/interfaces/IBlockChainWallet";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { getAgentSettings } from "../utils/fasset-helpers";
import { CollateralPrice } from "../state/CollateralPrice";
import { CollateralDataFactory } from "./CollateralData";
import { IAssetAgentBotContext } from "../fasset-bots/IAssetBotContext";
import { artifacts } from "../utils/web3";
import BN from "bn.js";
import { AddressValidity } from "@flarenetwork/state-connector-protocol";

const AgentVault = artifacts.require("AgentVault");
const CollateralPool = artifacts.require("CollateralPool");
const CollateralPoolToken = artifacts.require("CollateralPoolToken");
const IERC20 = artifacts.require("IERC20");

export class OwnerAddressPair {
    constructor(
        public managementAddress: string,
        public workAddress: string,
    ) {}

    toString() {
        return `${this.managementAddress} with work address ${this.workAddress}`;
    }
}

export class Agent {
    static deepCopyWithObjectCreate = true;

    constructor(
        public context: IAssetAgentBotContext,
        public owner: OwnerAddressPair,
        public agentVault: AgentVaultInstance,
        public collateralPool: CollateralPoolInstance,
        public collateralPoolToken: CollateralPoolTokenInstance,
        public underlyingAddress: string
    ) {}

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

    async getAgentSettings(): Promise<AgentSettings> {
        const agentInfo = await this.getAgentInfo();
        return getAgentSettings(agentInfo);
    }

    async getAgentInfo(): Promise<AgentInfo> {
        return await this.assetManager.getAgentInfo(this.agentVault.address);
    }

    async getVaultCollateral(): Promise<CollateralType> {
        return await this.assetManager.getCollateralType(CollateralClass.VAULT, (await this.getAgentSettings()).vaultCollateralToken);
    }

    async getPoolCollateral(): Promise<CollateralType> {
        return await this.assetManager.getCollateralType(CollateralClass.POOL, await this.assetManager.getWNat());
    }

    async getVaultCollateralPrice(): Promise<CollateralPrice> {
        const settings = await this.assetManager.getSettings();
        const collateralDataFactory = await CollateralDataFactory.create(settings);
        return await CollateralPrice.forCollateral(collateralDataFactory.priceReader, settings, await this.getVaultCollateral());
    }

    async getPoolCollateralPrice(): Promise<CollateralPrice> {
        const settings = await this.assetManager.getSettings();
        const collateralDataFactory = await CollateralDataFactory.create(settings);
        return await CollateralPrice.forCollateral(collateralDataFactory.priceReader, settings, await this.getPoolCollateral());
    }

    /**
     * Creates instance of Agent
     * @param ctx fasset agent bot context
     * @param ownerManagementAddress native owner address
     * @param agentSettings desired agent's initial setting
     * @param index needed/used in case pool token suffix is already taken
     * @returns instance of Agent
     */

    static async create(ctx: IAssetAgentBotContext, owner: OwnerAddressPair, addressValidityProof: AddressValidity.Proof, agentSettings: AgentSettings): Promise<Agent> {
        // create agent
        const response = await ctx.assetManager.createAgentVault(
            web3DeepNormalize(addressValidityProof), web3DeepNormalize(agentSettings), { from: owner.workAddress });
        // extract agent vault address from AgentVaultCreated event
        const event = findRequiredEvent(response, "AgentVaultCreated");
        // get vault contract at agent's vault address address
        const agentVault = await AgentVault.at(event.args.agentVault);
        // get collateral pool
        const collateralPool = await CollateralPool.at(event.args.collateralPool);
        // get pool token
        const poolTokenAddress = await collateralPool.poolToken();
        const collateralPoolToken = await CollateralPoolToken.at(poolTokenAddress);
        // create object
        return new Agent(ctx, owner, agentVault, collateralPool, collateralPoolToken, addressValidityProof.data.responseBody.standardAddress);
    }

    static async getOwnerWorkAddress(ctx: IAssetAgentBotContext, ownerManagementAddress: string) {
        return await ctx.agentOwnerRegistry.getWorkAddress(ownerManagementAddress);
    }

    static async getOwnerAddressPair(ctx: IAssetAgentBotContext, ownerManagementAddress: string): Promise<OwnerAddressPair> {
        const ownerWorkAddress = await Agent.getOwnerWorkAddress(ctx, ownerManagementAddress);
        return new OwnerAddressPair(ownerManagementAddress, ownerWorkAddress);
    }

    /**
     * Deposits vault collateral
     * @param amountTokenWei amount to be deposited in wei
     */
    async depositVaultCollateral(amountTokenWei: BNish) {
        const vaultCollateralTokenAddress = (await this.getVaultCollateral()).token;
        const vaultCollateralToken = await IERC20.at(vaultCollateralTokenAddress);
        await vaultCollateralToken.approve(this.vaultAddress, amountTokenWei, { from: this.owner.workAddress });
        return await this.agentVault.depositCollateral(vaultCollateralTokenAddress, amountTokenWei, { from: this.owner.workAddress });
    }

    /**
     * Adds pool collateral and agent pool tokens
     * @param amountNatWei amount to be deposited in nat wei
     */
    async buyCollateralPoolTokens(amountNatWei: BNish) {
        return await this.agentVault.buyCollateralPoolTokens({ from: this.owner.workAddress, value: toBN(amountNatWei) });
    }

    /**
     * Makes agent available.
     * @returns event's AgentAvailable arguments
     */
    async makeAvailable(): Promise<EventArgs<AgentAvailable>> {
        const res = await this.assetManager.makeAgentAvailable(this.vaultAddress, { from: this.owner.workAddress });
        return requiredEventArgs(res, "AgentAvailable");
    }

    /**
     * Announces agent's available exit
     * @returns timestamp when exit is allowed
     */
    async announceExitAvailable(): Promise<BN> {
        const res = await this.assetManager.announceExitAvailableAgentList(this.vaultAddress, { from: this.owner.workAddress });
        const args = requiredEventArgs(res, "AvailableAgentExitAnnounced");
        return toBN(args.exitAllowedAt);
    }

    /**
     * Exits agent available.
     * @returns event's AvailableAgentExited arguments
     */
    async exitAvailable(): Promise<EventArgs<AvailableAgentExited>> {
        const res = await this.assetManager.exitAvailableAgentList(this.vaultAddress, { from: this.owner.workAddress });
        return requiredEventArgs(res, "AvailableAgentExited");
    }

    /**
     * Announces agent's vault collateral withdrawal
     * @param amountWei amount to be withdrawn in wei
     * @returns timestamp when withdrawal is allowed
     */
    async announceVaultCollateralWithdrawal(amountWei: BNish): Promise<BN> {
        const res = await this.assetManager.announceVaultCollateralWithdrawal(this.vaultAddress, amountWei, { from: this.owner.workAddress });
        const args = requiredEventArgs(res, "VaultCollateralWithdrawalAnnounced");
        return toBN(args.withdrawalAllowedAt);
    }

    /**
     * Withdraws agent's vault collateral
     * @param amountWei amount to be withdrawn in wei
     * @returns
     */
    async withdrawVaultCollateral(amountWei: BNish) {
        const vaultCollateralTokenAddress = (await this.getVaultCollateral()).token;
        return await this.agentVault.withdrawCollateral(vaultCollateralTokenAddress, amountWei, this.owner.workAddress, { from: this.owner.workAddress });
    }

    /**
     * Withdraws pool fees
     * @param amountUBA amount to be withdrawn in uba
     * @param recipient native address that receives pool fees
     * @returns
     */
    async withdrawPoolFees(amountUBA: BNish, recipient: string = this.owner.workAddress): Promise<void> {
        await this.agentVault.withdrawPoolFees(amountUBA, recipient, { from: this.owner.workAddress });
    }

    /**
     * Gets pool fee balance
     * @returns pool fee balance
     */
    async poolFeeBalance(): Promise<BN> {
        return await this.collateralPool.fAssetFeesOf(this.vaultAddress);
    }

    /**
     * Announces agent's vault destruction
     * @returns timestamp when destruction is allowed
     */
    async announceDestroy(): Promise<BN> {
        const res = await this.assetManager.announceDestroyAgent(this.vaultAddress, { from: this.owner.workAddress });
        const args = requiredEventArgs(res, "AgentDestroyAnnounced");
        return toBN(args.destroyAllowedAt);
    }

    /**
     * Destroys agent's vault
     * @param amountWei amount to be withdrawn in wei
     * @returns
     */
    async destroy(recipient: string = this.owner.workAddress): Promise<EventArgs<AgentDestroyed>> {
        const res = await this.assetManager.destroyAgent(this.vaultAddress, recipient, { from: this.owner.workAddress });
        return requiredEventArgs(res, "AgentDestroyed");
    }

    /**
     * Performs underlying top up
     * @param amount amount to be topped up
     * @param underlyingAddress source underlying address
     * @returns transaction hash
     */
    async performTopupPayment(amount: BNish, underlyingAddress: string): Promise<string> {
        return await this.wallet.addTransaction(underlyingAddress, this.underlyingAddress, amount, PaymentReference.topup(this.agentVault.address));
    }

    /**
     * Confirms underlying top up
     * @param transactionHash transaction hash of top up payment
     */
    async confirmTopupPayment(transactionHash: string): Promise<void> {
        const proof = await this.attestationProvider.provePayment(transactionHash, null, this.underlyingAddress);
        await this.assetManager.confirmTopupPayment(web3DeepNormalize(proof), this.agentVault.address, { from: this.owner.workAddress });
    }

    /**
     * Announces underlying withdrawal
     * @returns event's UnderlyingWithdrawalAnnounced arguments
     */
    async announceUnderlyingWithdrawal(): Promise<EventArgs<UnderlyingWithdrawalAnnounced>> {
        const res = await this.assetManager.announceUnderlyingWithdrawal(this.agentVault.address, { from: this.owner.workAddress });
        return requiredEventArgs(res, "UnderlyingWithdrawalAnnounced");
    }

    /**
     * Performs underlying withdrawal
     * @param paymentReference payment reference from announce underlying withdrawal
     * @param amount amount to be withdrawn
     * @param underlyingAddress destination underlying address
     * @returns transaction hash
     */
    async performUnderlyingWithdrawal(paymentReference: string, amount: BNish, underlyingAddress: string): Promise<string> {
        return await this.wallet.addTransaction(this.underlyingAddress, underlyingAddress, amount, paymentReference);
    }

    /**
     * Confirms underlying withdrawal
     * @param transactionHash transaction hash of underlying payment
     * @returns event's UnderlyingWithdrawalAnnounced arguments
     */
    async confirmUnderlyingWithdrawal(transactionHash: string): Promise<EventArgs<UnderlyingWithdrawalConfirmed>> {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, null);
        const res = await this.assetManager.confirmUnderlyingWithdrawal(web3DeepNormalize(proof), this.agentVault.address, { from: this.owner.workAddress });
        return requiredEventArgs(res, "UnderlyingWithdrawalConfirmed");
    }

    /**
     * Cancels underlying withdrawal
     * @returns event's UnderlyingWithdrawalCancelled arguments
     */
    async cancelUnderlyingWithdrawal(): Promise<EventArgs<UnderlyingWithdrawalCancelled>> {
        const res = await this.assetManager.cancelUnderlyingWithdrawal(this.agentVault.address, { from: this.owner.workAddress });
        return requiredEventArgs(res, "UnderlyingWithdrawalCancelled");
    }

    /**
     * Performs agent's self-closing
     * @param amountUBA amount of fassets to self-close
     * @returns event's SelfClose arguments
     */
    async selfClose(amountUBA: BNish): Promise<EventArgs<SelfClose>> {
        const res = await this.assetManager.selfClose(this.agentVault.address, amountUBA, { from: this.owner.workAddress });
        return requiredEventArgs(res, "SelfClose");
    }

    /**
     * Performs underlying payment
     * @param paymentAddress underlying destination address
     * @param paymentAmount amount to be transferred
     * @param paymentReference payment reference
     * @param options instance of TransactionOptionsWithFee
     * @returns transaction hash
     */
    async performPayment(paymentAddress: string, paymentAmount: BNish, paymentReference: string | null = null, options?: TransactionOptionsWithFee) {
        return this.wallet.addTransaction(this.underlyingAddress, paymentAddress, paymentAmount, paymentReference, options);
    }

    /**
     * Announces agent's setting update
     * @param settingName
     * @param settingValue
     * @returns timestamp when setting update is allowed
     */
    async announceAgentSettingUpdate(settingName: string, settingValue: BNish) {
        const res = await this.assetManager.announceAgentSettingUpdate(this.vaultAddress, settingName, settingValue, { from: this.owner.workAddress });
        const args = requiredEventArgs(res, "AgentSettingChangeAnnounced");
        return toBN(args.validAt);
    }

    /**
     * Executes agent's setting update
     * @param settingName
     */
    async executeAgentSettingUpdate(settingName: string): Promise<void> {
        await this.assetManager.executeAgentSettingUpdate(this.vaultAddress, settingName, { from: this.owner.workAddress });
    }

    /**
     * Announces pool token redemption
     * @param amountWei amount to be redeemed
     * @returns timestamp when withdrawn is allowed
     */
    async announcePoolTokenRedemption(amountWei: BNish) {
        const res = await this.assetManager.announceAgentPoolTokenRedemption(this.vaultAddress, amountWei, { from: this.owner.workAddress });
        const args = requiredEventArgs(res, "PoolTokenRedemptionAnnounced");
        return toBN(args.withdrawalAllowedAt);
    }

    /**
     * Redeems collateral pool tokens
     * @param amountWei amount to be redeemed
     * @param recipient receiver's native address
     * @returns
     */
    async redeemCollateralPoolTokens(amountWei: BNish, recipient: string = this.owner.workAddress) {
        return await this.agentVault.redeemCollateralPoolTokens(amountWei, recipient, { from: this.owner.workAddress });
    }

    /**
     * Switches vault collateral. If the current agent's vault collateral token gets deprecated, the agent must switch with this method.
     * @param token vault collateral token address
     */
    async switchVaultCollateral(token: string): Promise<void> {
        await this.assetManager.switchVaultCollateral(this.vaultAddress, token, { from: this.owner.workAddress });
    }

    /**
     * Upgrades WNat contract. It swaps old WNat tokens for new ones and sets it for use by the pool.
     */
    async upgradeWNatContract(): Promise<void> {
        await this.assetManager.upgradeWNatContract(this.vaultAddress, { from: this.owner.workAddress });
    }
}
