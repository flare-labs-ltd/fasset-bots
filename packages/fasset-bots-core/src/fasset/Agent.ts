import { AddressValidity } from "@flarenetwork/state-connector-protocol";
import BN from "bn.js";
import { AgentVaultInstance, CollateralPoolInstance, CollateralPoolTokenInstance } from "../../typechain-truffle";
import {
    AgentAvailable,
    AgentDestroyed,
    AllEvents,
    AvailableAgentExited,
    IIAssetManagerInstance,
    SelfClose,
    UnderlyingWithdrawalAnnounced,
    UnderlyingWithdrawalCancelled,
    UnderlyingWithdrawalConfirmed,
} from "../../typechain-truffle/IIAssetManager";
import { IAssetAgentContext } from "../fasset-bots/IAssetBotContext";
import { CollateralPrice } from "../state/CollateralPrice";
import { TokenPriceReader } from "../state/TokenPrice";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { IBlockChainWallet, TransactionOptionsWithFee } from "../underlying-chain/interfaces/IBlockChainWallet";
import { logger } from "../utils";
import { EventArgs } from "../utils/events/common";
import { ContractWithEvents, findRequiredEvent, requiredEventArgs } from "../utils/events/truffle";
import { checkUnderlyingFunds, getAgentSettings } from "../utils/fasset-helpers";
import { BNish, expectErrors, MAX_BIPS, toBN } from "../utils/helpers";
import { artifacts } from "../utils/web3";
import { web3DeepNormalize } from "../utils/web3normalize";
import { AgentInfo, AgentSettings, AssetManagerSettings, CollateralClass, CollateralType } from "./AssetManagerTypes";
import { PaymentReference } from "./PaymentReference";
import { time } from "@openzeppelin/test-helpers";


const AgentVault = artifacts.require("AgentVault");
const CollateralPool = artifacts.require("CollateralPool");
const CollateralPoolToken = artifacts.require("CollateralPoolToken");
const IERC20 = artifacts.require("IERC20");

export class OwnerAddressPair {
    constructor(
        public managementAddress: string,
        public workAddress: string,
    ) { }

    toString() {
        return `${this.managementAddress} with work address ${this.workAddress}`;
    }
}

export class Agent {
    static deepCopyWithObjectCreate = true;

    constructor(
        public context: IAssetAgentContext,
        public owner: OwnerAddressPair,
        public agentVault: AgentVaultInstance,
        public collateralPool: CollateralPoolInstance,
        public collateralPoolToken: CollateralPoolTokenInstance,
        public underlyingAddress: string
    ) { }

    get assetManager(): ContractWithEvents<IIAssetManagerInstance, AllEvents> {
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

    async getAgentInfoIfExists(): Promise<AgentInfo | null> {
        try {
            return await this.assetManager.getAgentInfo(this.agentVault.address);
        } catch (error) {
            expectErrors(error, ["invalid agent vault address"]);
            return null;
        }
    }

    async getVaultCollateral(): Promise<CollateralType> {
        const agentSettings = await this.getAgentSettings();
        return await this.assetManager.getCollateralType(CollateralClass.VAULT, agentSettings.vaultCollateralToken);
    }

    async getPoolCollateral(): Promise<CollateralType> {
        return await this.assetManager.getCollateralType(CollateralClass.POOL, await this.assetManager.getWNat());
    }

    async getVaultCollateralPrice(settings?: AssetManagerSettings): Promise<CollateralPrice> {
        settings ??= await this.assetManager.getSettings();
        const priceReader = await TokenPriceReader.create(settings);
        return await CollateralPrice.forCollateral(priceReader, settings, await this.getVaultCollateral());
    }

    async getPoolCollateralPrice(settings?: AssetManagerSettings): Promise<CollateralPrice> {
        settings ??= await this.assetManager.getSettings();
        const priceReader = await TokenPriceReader.create(settings);
        return await CollateralPrice.forCollateral(priceReader, settings, await this.getPoolCollateral());
    }

    /**
     * Creates instance of Agent
     * @param ctx fasset agent bot context
     * @param ownerManagementAddress native owner address
     * @param agentSettings desired agent's initial setting
     * @param index needed/used in case pool token suffix is already taken
     * @returns instance of Agent
     */
    static async create(ctx: IAssetAgentContext, owner: OwnerAddressPair, addressValidityProof: AddressValidity.Proof, agentSettings: AgentSettings): Promise<Agent> {
        // create agent
        const response = await ctx.assetManager.createAgentVault(
            web3DeepNormalize(addressValidityProof), web3DeepNormalize(agentSettings), { from: owner.workAddress });
        // extract agent vault address from AgentVaultCreated event
        const event = findRequiredEvent(response, "AgentVaultCreated");
        // get vault contract at agent's vault address address
        const agentVault = await AgentVault.at(event.args.agentVault);
        // get collateral pool
        const collateralPool = await CollateralPool.at(event.args.creationData.collateralPool);
        // get pool token
        const poolTokenAddress = await collateralPool.poolToken();
        const collateralPoolToken = await CollateralPoolToken.at(poolTokenAddress);
        // create object
        return new Agent(ctx, owner, agentVault, collateralPool, collateralPoolToken, addressValidityProof.data.responseBody.standardAddress);
    }

    static async getOwnerWorkAddress(ctx: IAssetAgentContext, ownerManagementAddress: string) {
        return await ctx.agentOwnerRegistry.getWorkAddress(ownerManagementAddress);
    }

    static async getOwnerAddressPair(ctx: IAssetAgentContext, ownerManagementAddress: string): Promise<OwnerAddressPair> {
        const ownerWorkAddress = await Agent.getOwnerWorkAddress(ctx, ownerManagementAddress);
        return new OwnerAddressPair(ownerManagementAddress, ownerWorkAddress);
    }

    /**
     * Deposits vault collateral
     * @param amountTokenWei amount to be deposited in wei
     */
    async depositVaultCollateral(amountTokenWei: BNish) {
        const vaultCollateral = await this.getVaultCollateral();
        return await this.depositTokensToVault(vaultCollateral.token, amountTokenWei);
    }

    /**
     * Deposits any ERC20 tokens to agents vault.
     */
    async depositTokensToVault(tokenAddress: string, amountTokenWei: BNish) {
        const token = await IERC20.at(tokenAddress);
        await token.approve(this.vaultAddress, amountTokenWei, { from: this.owner.workAddress });
        return await this.agentVault.depositCollateral(tokenAddress, amountTokenWei, { from: this.owner.workAddress });
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
        return await this.performPayment(this.underlyingAddress, amount, PaymentReference.topup(this.agentVault.address), underlyingAddress);
    }

    /**
     * Initiates underlying top up
     * @param amount amount to be topped up
     * @param underlyingAddress source underlying address
     * @returns transaction id from local database
     */
    async initiateTopupPayment(amount: BNish, underlyingAddress: string): Promise<number> {
        return await this.initiatePayment(this.underlyingAddress, amount, PaymentReference.topup(this.agentVault.address), underlyingAddress);
    }

    /**
     * Initiates self-mint underlying payment.
     * @param amount amount to be topped up
     * @param underlyingAddress source underlying address
     * @returns transaction id from local database
     */
    async initiateSelfMintPayment(amount: BNish, underlyingAddress: string): Promise<number> {
        return await this.initiatePayment(this.underlyingAddress, amount, PaymentReference.selfMint(this.agentVault.address), underlyingAddress);
    }

    /**
     * The amount of underlying payment required to mint `lots` lots (in UBA).
     * Includes minted amount and pool fee share.
     */
    async getSelfMintPaymentAmount(lots: BNish) {
        const lotSize = await this.context.assetManager.lotSize();
        const agentSettings = await this.getAgentSettings();
        // amount to mint
        const amountUBA = toBN(lots).mul(lotSize);
        // pool fee
        const feeBIPS = toBN(agentSettings.feeBIPS);
        const poolFeeShareBIPS = toBN(agentSettings.poolFeeShareBIPS);
        const poolFeeUBA = amountUBA.mul(feeBIPS).divn(MAX_BIPS).mul(poolFeeShareBIPS).divn(MAX_BIPS);
        // amount to pay
        return amountUBA.add(poolFeeUBA);
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
    async performPayment(paymentDestinationAddress: string, paymentAmount: BNish, paymentReference: string | null = null, paymentSourceAddress: string = this.underlyingAddress, options?: TransactionOptionsWithFee): Promise<string> {
        await checkUnderlyingFunds(this.context, paymentSourceAddress, paymentAmount, paymentDestinationAddress);
        return await this.wallet.addTransactionAndWaitForItsFinalization(paymentSourceAddress, paymentDestinationAddress, paymentAmount, paymentReference, options);
    }

    /**
     * Initiates underlying payment. Used by redemption, free underlying withdrawal and top up payments.
     * @param paymentDestinationAddress
     * @param paymentAmount amount to be transferred
     * @param paymentReference payment reference
     * @param paymentSourceAddress
     * @param options instance of TransactionOptionsWithFee
     * @returns transaction id from local database
     */
    async initiatePayment(
        paymentDestinationAddress: string,
        paymentAmount: BNish,
        paymentReference: string | null = null,
        paymentSourceAddress: string = this.underlyingAddress,
        options?: TransactionOptionsWithFee
    ): Promise<number> {
        // No check for underlying payment as checks were already performed during redemption, withdrawal and top up initiation. Other transfers are using function performPayment.
        return await this.wallet.addTransaction(paymentSourceAddress, paymentDestinationAddress, paymentAmount, paymentReference, options);
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
     * Calculate the amount of new tokens needed to replace the old tokens in vault.
     */
    async calculateVaultCollateralReplacementAmount(token: string) {
        const oldCollateral = await this.getVaultCollateral();
        const newCollateral = await this.context.assetManager.getCollateralType(CollateralClass.VAULT, token);
        const settings = await this.context.assetManager.getSettings();
        const priceReader = await TokenPriceReader.create(settings);
        const oldPrice = await priceReader.getPrice(oldCollateral.tokenFtsoSymbol);
        const newPrice = await priceReader.getPrice(newCollateral.tokenFtsoSymbol);
        const oldToken = await IERC20.at(oldCollateral.token);
        const oldBalance = await oldToken.balanceOf(this.vaultAddress);
        return oldBalance.mul(oldPrice.price).div(newPrice.price);
    }

    /**
     * Upgrades WNat contract. It swaps old WNat tokens for new ones and sets it for use by the pool.
     */
    async upgradeWNatContract(): Promise<void> {
        await this.assetManager.upgradeWNatContract(this.vaultAddress, { from: this.owner.workAddress });
    }

    /**
     * Initiates underlying payment from agent to owner
     */
    async emptyAgentUnderlying(destinationAddress: string): Promise<number> {
        try {
            const txDbId = await this.wallet.deleteAccount(this.underlyingAddress, destinationAddress, null);
            logger.info(`Agent ${this.vaultAddress} initiated withdrawing of all funds on underlying ${this.underlyingAddress} with database id ${txDbId}.`);
            return txDbId;
        } catch (error) {
            logger.error(`Agent ${this.vaultAddress} could not initiated emptying underlying account:`, error);
            return 0;
        }
    }

    async agentPingResponse(query: BNish, response: string) {
        await this.assetManager.agentPingResponse(this.vaultAddress, query, response, { from: this.owner.workAddress });
    }

    // used for tests
    async claimTransferFees(recipient: string, maxClaimEpochs: BNish) {
        const res = await this.assetManager.claimTransferFees(this.vaultAddress, recipient, maxClaimEpochs, { from: this.owner.workAddress });
        return requiredEventArgs(res, "TransferFeesClaimed");
    }

    // used for tests
    async claimAndSendTransferFee(recipient: string) {
        if ((await this.assetManager.transferFeeMillionths()).eqn(0)) return;
        const transferFeeEpoch = await this.assetManager.currentTransferFeeEpoch();
        // get epoch duration
        const settings = await this.assetManager.transferFeeSettings();
        const epochDuration = settings.epochDuration;
        // move to next epoch
        await time.increase(epochDuration);
        // agent claims fee to redeemer address
        const args = await this.claimTransferFees(recipient, transferFeeEpoch);
        const poolClaimedFee = args.poolClaimedUBA;
        // agent withdraws transfer fee from the pool
        const transferFeeMillionths = await this.assetManager.transferFeeMillionths();
        // send more than pool claimed to cover transfer fee
        // assuming that agent has enough pool fees (from minting, ...)
        const withdrawAmount = poolClaimedFee.muln(1e6).div(toBN(1e6).sub(transferFeeMillionths)).addn(1);
        await this.withdrawPoolFees(withdrawAmount, recipient);
        return args;
    }
}
