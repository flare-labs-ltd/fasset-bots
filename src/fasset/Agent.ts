import { AgentVaultInstance, CollateralPoolInstance, CollateralPoolTokenInstance } from "../../typechain-truffle";
import {
    AgentAvailable,
    AgentDestroyed,
    AllEvents,
    AssetManagerInstance,
    AvailableAgentExited,
    SelfClose,
    UnderlyingWithdrawalAnnounced,
    UnderlyingWithdrawalCancelled,
    UnderlyingWithdrawalConfirmed,
} from "../../typechain-truffle/AssetManager";
import { ContractWithEvents, findRequiredEvent, requiredEventArgs } from "../utils/events/truffle";
import { BNish, MINUS_CHAR, requireNotNull, toBN } from "../utils/helpers";
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

const AgentVault = artifacts.require("AgentVault");
const CollateralPool = artifacts.require("CollateralPool");
const CollateralPoolToken = artifacts.require("CollateralPoolToken");

export class Agent {
    constructor(
        public context: IAssetAgentBotContext,
        public ownerAddress: string,
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

    static async create(ctx: IAssetAgentBotContext, ownerAddress: string, agentSettings: AgentSettings, index: number = 0): Promise<Agent> {
        const desiredErrorIncludes = "suffix already reserved";
        try {
            // create agent
            const response = await ctx.assetManager.createAgentVault(web3DeepNormalize(agentSettings), { from: ownerAddress });
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
            return new Agent(ctx, ownerAddress, agentVault, collateralPool, collateralPoolToken, agentSettings.underlyingAddressString);
        } catch (error: any) {
            if (error instanceof Error && error.message.includes(desiredErrorIncludes)) {
                index++;
                agentSettings.poolTokenSuffix = this.incrementPoolTokenSuffix(agentSettings.poolTokenSuffix, index);
                return Agent.create(ctx, ownerAddress, agentSettings, index);
            } else {
                throw new Error(error);
            }
        }
    }

    async depositVaultCollateral(amountTokenWei: BNish) {
        const vaultCollateralTokenAddress = (await this.getVaultCollateral()).token;
        const vaultCollateralToken = requireNotNull(Object.values(this.context.stablecoins).find((token) => token.address === vaultCollateralTokenAddress));
        await vaultCollateralToken.approve(this.vaultAddress, amountTokenWei, { from: this.ownerAddress });
        return await this.agentVault.depositCollateral(vaultCollateralTokenAddress, amountTokenWei, { from: this.ownerAddress });
    }

    // adds pool collateral and agent pool tokens
    async buyCollateralPoolTokens(amountNatWei: BNish) {
        return await this.agentVault.buyCollateralPoolTokens({ from: this.ownerAddress, value: toBN(amountNatWei) });
    }

    async makeAvailable(): Promise<EventArgs<AgentAvailable>> {
        const res = await this.assetManager.makeAgentAvailable(this.vaultAddress, { from: this.ownerAddress });
        return requiredEventArgs(res, "AgentAvailable");
    }

    async announceExitAvailable(): Promise<BN> {
        const res = await this.assetManager.announceExitAvailableAgentList(this.vaultAddress, { from: this.ownerAddress });
        const args = requiredEventArgs(res, "AvailableAgentExitAnnounced");
        return args.exitAllowedAt;
    }

    async exitAvailable(): Promise<EventArgs<AvailableAgentExited>> {
        const res = await this.assetManager.exitAvailableAgentList(this.vaultAddress, { from: this.ownerAddress });
        return requiredEventArgs(res, "AvailableAgentExited");
    }

    async announceVaultCollateralWithdrawal(amountWei: BNish): Promise<BN> {
        const res = await this.assetManager.announceVaultCollateralWithdrawal(this.vaultAddress, amountWei, { from: this.ownerAddress });
        const args = requiredEventArgs(res, "VaultCollateralWithdrawalAnnounced");
        return args.withdrawalAllowedAt;
    }

    async withdrawVaultCollateral(amountWei: BNish) {
        const vaultCollateralTokenAddress = (await this.getVaultCollateral()).token;
        return await this.agentVault.withdrawCollateral(vaultCollateralTokenAddress, amountWei, this.ownerAddress, { from: this.ownerAddress });
    }

    async withdrawPoolFees(amountUBA: BNish, recipient: string = this.ownerAddress) {
        await this.agentVault.withdrawPoolFees(amountUBA, recipient, { from: this.ownerAddress });
    }

    async poolFeeBalance(): Promise<BN> {
        return await this.collateralPool.fAssetFeesOf(this.vaultAddress);
    }

    async announceDestroy(): Promise<BN> {
        const res = await this.assetManager.announceDestroyAgent(this.vaultAddress, { from: this.ownerAddress });
        const args = requiredEventArgs(res, "AgentDestroyAnnounced");
        return args.destroyAllowedAt;
    }

    async destroy(recipient: string = this.ownerAddress): Promise<EventArgs<AgentDestroyed>> {
        const res = await this.assetManager.destroyAgent(this.vaultAddress, recipient, { from: this.ownerAddress });
        return requiredEventArgs(res, "AgentDestroyed");
    }

    async performTopupPayment(amount: BNish, underlyingAddress: string): Promise<string> {
        return await this.wallet.addTransaction(underlyingAddress, this.underlyingAddress, amount, PaymentReference.topup(this.agentVault.address));
    }

    async confirmTopupPayment(transactionHash: string): Promise<void> {
        const proof = await this.attestationProvider.provePayment(transactionHash, null, this.underlyingAddress);
        await this.assetManager.confirmTopupPayment(web3DeepNormalize(proof), this.agentVault.address, { from: this.ownerAddress });
    }

    async announceUnderlyingWithdrawal(): Promise<EventArgs<UnderlyingWithdrawalAnnounced>> {
        const res = await this.assetManager.announceUnderlyingWithdrawal(this.agentVault.address, { from: this.ownerAddress });
        return requiredEventArgs(res, "UnderlyingWithdrawalAnnounced");
    }

    async performUnderlyingWithdrawal(paymentReference: string, amount: BNish, underlyingAddress: string): Promise<string> {
        return await this.wallet.addTransaction(this.underlyingAddress, underlyingAddress, amount, paymentReference);
    }

    async confirmUnderlyingWithdrawal(transactionHash: string): Promise<EventArgs<UnderlyingWithdrawalConfirmed>> {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, null);
        const res = await this.assetManager.confirmUnderlyingWithdrawal(web3DeepNormalize(proof), this.agentVault.address, { from: this.ownerAddress });
        return requiredEventArgs(res, "UnderlyingWithdrawalConfirmed");
    }

    async cancelUnderlyingWithdrawal(): Promise<EventArgs<UnderlyingWithdrawalCancelled>> {
        const res = await this.assetManager.cancelUnderlyingWithdrawal(this.agentVault.address, { from: this.ownerAddress });
        return requiredEventArgs(res, "UnderlyingWithdrawalCancelled");
    }

    async selfClose(amountUBA: BNish): Promise<EventArgs<SelfClose>> {
        const res = await this.assetManager.selfClose(this.agentVault.address, amountUBA, { from: this.ownerAddress });
        return requiredEventArgs(res, "SelfClose");
    }

    async performPayment(
        paymentAddress: string,
        paymentAmount: BNish,
        paymentReference: string | null = null,
        options?: TransactionOptionsWithFee
    ): Promise<string> {
        return this.wallet.addTransaction(this.underlyingAddress, paymentAddress, paymentAmount, paymentReference, options);
    }

    async announceAgentSettingUpdate(settingName: string, settingValue: BNish): Promise<BN> {
        const res = await this.assetManager.announceAgentSettingUpdate(this.vaultAddress, settingName, settingValue, { from: this.ownerAddress });
        const args = requiredEventArgs(res, "AgentSettingChangeAnnounced");
        return args.validAt;
    }

    async executeAgentSettingUpdate(settingName: string): Promise<void> {
        await this.assetManager.executeAgentSettingUpdate(this.vaultAddress, settingName, { from: this.ownerAddress });
    }

    async announcePoolTokenRedemption(amountWei: BNish) {
        const res = await this.assetManager.announceAgentPoolTokenRedemption(this.vaultAddress, amountWei, { from: this.ownerAddress });
        const args = requiredEventArgs(res, "PoolTokenRedemptionAnnounced");
        return args.withdrawalAllowedAt;
    }

    async redeemCollateralPoolTokens(amountWei: BNish, recipient: string = this.ownerAddress) {
        return await this.agentVault.redeemCollateralPoolTokens(amountWei, recipient, { from: this.ownerAddress });
    }

    static incrementPoolTokenSuffix(poolTokenSuffix: string, index: number): string {
        if (index == 1) {
            return poolTokenSuffix + MINUS_CHAR + index;
        } else if (index > 1) {
            const last = poolTokenSuffix.lastIndexOf(MINUS_CHAR);
            return poolTokenSuffix.substring(0, last) + MINUS_CHAR + index;
        } else {
            return poolTokenSuffix;
        }
    }
}
