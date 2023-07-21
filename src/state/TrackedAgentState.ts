import BN from "bn.js";
import { AgentInfo, AgentStatus, CollateralType, CollateralClass } from "../fasset/AssetManagerTypes";
import { BN_ONE, BN_ZERO, BNish, MAX_BIPS, MAX_UINT256, maxBN, toBN } from "../utils/helpers";
import { TrackedState } from "./TrackedState";
import { EventArgs } from "../utils/events/common";
import { AgentAvailable, CollateralReservationDeleted, CollateralReserved, DustChanged, LiquidationPerformed, MintingExecuted, MintingPaymentDefault, RedemptionDefault, RedemptionPaymentBlocked, RedemptionPaymentFailed, RedemptionPerformed, RedemptionRequested, SelfClose, UnderlyingBalanceToppedUp, UnderlyingWithdrawalAnnounced, UnderlyingWithdrawalConfirmed } from "../../typechain-truffle/AssetManagerController";
import { web3Normalize } from "../utils/web3normalize";
import { Prices } from "./Prices";
import { AgentCreated, RedeemedInCollateral } from "../../typechain-truffle/AssetManager";
import { roundUBAToAmg } from "../fasset/Conversions";

export type InitialAgentData = EventArgs<AgentCreated>;

export class TrackedAgentState {
    constructor(
        public parent: TrackedState,
        data: InitialAgentData
    ) {
        this.vaultAddress = data.agentVault;
        this.underlyingAddress = data.underlyingAddress;
        this.contingencyPoolAddress = data.contingencyPool;
        this.agentSettings.vaultCollateralToken = data.vaultCollateralToken;
        this.agentSettings.feeBIPS = toBN(data.feeBIPS);
        this.agentSettings.poolFeeShareBIPS = toBN(data.poolFeeShareBIPS);
        this.agentSettings.mintingVaultCollateralRatioBIPS = toBN(data.mintingVaultCollateralRatioBIPS);
        this.agentSettings.mintingPoolCollateralRatioBIPS = toBN(data.mintingPoolCollateralRatioBIPS);
        this.agentSettings.poolExitCollateralRatioBIPS = toBN(data.poolExitCollateralRatioBIPS);
        this.agentSettings.buyFAssetByAgentFactorBIPS = toBN(data.buyFAssetByAgentFactorBIPS);
        this.agentSettings.poolTopupCollateralRatioBIPS = toBN(data.poolTopupCollateralRatioBIPS);
        this.agentSettings.poolTopupTokenPriceFactorBIPS = toBN(data.poolTopupTokenPriceFactorBIPS);
    }

    // identifying addresses
    vaultAddress: string;
    underlyingAddress: string;
    contingencyPoolAddress: string;

    //status
    status = AgentStatus.NORMAL;
    publiclyAvailable: boolean = false;

    //state
    totalVaultCollateralWei: { [key: string]: BN } = {};
    totalPoolCollateralNATWei: BN = BN_ZERO;
    ccbStartTimestamp: BN = BN_ZERO;                // 0 - not in ccb/liquidation
    liquidationStartTimestamp: BN = BN_ZERO;        // 0 - not in liquidation
    announcedUnderlyingWithdrawalId: BN = BN_ZERO;  // 0 - not announced

    // agent settings
    agentSettings = {
        vaultCollateralToken: "",
        feeBIPS: BN_ZERO,
        poolFeeShareBIPS: BN_ZERO,
        mintingVaultCollateralRatioBIPS: BN_ZERO,
        mintingPoolCollateralRatioBIPS: BN_ZERO,
        poolExitCollateralRatioBIPS: BN_ZERO,
        buyFAssetByAgentFactorBIPS: BN_ZERO,
        poolTopupCollateralRatioBIPS: BN_ZERO,
        poolTopupTokenPriceFactorBIPS: BN_ZERO
    };

    // aggregates
    reservedUBA: BN = BN_ZERO;
    mintedUBA: BN = BN_ZERO;
    redeemingUBA: BN = BN_ZERO;
    poolRedeemingUBA: BN = BN_ZERO;
    dustUBA: BN = BN_ZERO;
    underlyingBalanceUBA: BN = BN_ZERO;

    // calculated getters
    get requiredUnderlyingBalanceUBA(): BN {
        const backedUBA = this.mintedUBA.add(this.redeemingUBA);
        return backedUBA.mul(toBN(this.parent.settings.minUnderlyingBackingBIPS)).divn(MAX_BIPS);
    }

    get freeUnderlyingBalanceUBA(): BN {
        return this.underlyingBalanceUBA.sub(this.requiredUnderlyingBalanceUBA);
    }

    initialize(agentInfo: AgentInfo): void {
        this.status = Number(agentInfo.status);
        this.publiclyAvailable = agentInfo.publiclyAvailable;
        this.totalPoolCollateralNATWei = toBN(agentInfo.totalPoolCollateralNATWei);
        this.totalVaultCollateralWei[agentInfo.vaultCollateralToken] = toBN(agentInfo.totalVaultCollateralWei);
        this.ccbStartTimestamp = toBN(agentInfo.ccbStartTimestamp);
        this.liquidationStartTimestamp = toBN(agentInfo.liquidationStartTimestamp);
        this.announcedUnderlyingWithdrawalId = toBN(agentInfo.announcedUnderlyingWithdrawalId);
        this.reservedUBA = toBN(agentInfo.reservedUBA);
        this.mintedUBA = toBN(agentInfo.mintedUBA);
        this.redeemingUBA = toBN(agentInfo.redeemingUBA);
        this.poolRedeemingUBA = toBN(agentInfo.poolRedeemingUBA);
        this.dustUBA = toBN(agentInfo.dustUBA);
        this.underlyingBalanceUBA = toBN(agentInfo.underlyingBalanceUBA);
        this.agentSettings.vaultCollateralToken = agentInfo.vaultCollateralToken;
        this.agentSettings.feeBIPS = toBN(agentInfo.feeBIPS);
        this.agentSettings.poolFeeShareBIPS = toBN(agentInfo.poolFeeShareBIPS);
        this.agentSettings.mintingVaultCollateralRatioBIPS = toBN(agentInfo.mintingVaultCollateralRatioBIPS);
        this.agentSettings.mintingPoolCollateralRatioBIPS = toBN(agentInfo.mintingPoolCollateralRatioBIPS);
        this.agentSettings.poolExitCollateralRatioBIPS = toBN(agentInfo.poolExitCollateralRatioBIPS);
        this.agentSettings.buyFAssetByAgentFactorBIPS = toBN(agentInfo.buyFAssetByAgentFactorBIPS);
        this.agentSettings.poolTopupCollateralRatioBIPS = toBN(agentInfo.poolTopupCollateralRatioBIPS);
        this.agentSettings.poolTopupTokenPriceFactorBIPS = toBN(agentInfo.poolTopupTokenPriceFactorBIPS);
    }

    handleStatusChange(status: AgentStatus, timestamp?: BN): void {
        if (timestamp && this.status === AgentStatus.NORMAL && status === AgentStatus.CCB) {
            this.ccbStartTimestamp = timestamp;
        }
        if (timestamp && (this.status === AgentStatus.NORMAL || this.status === AgentStatus.CCB) && (status === AgentStatus.LIQUIDATION || status === AgentStatus.FULL_LIQUIDATION)) {
            this.liquidationStartTimestamp = timestamp;
        }
        this.status = status;
    }

    // handlers: minting
    handleCollateralReserved(args: EventArgs<CollateralReserved>) {
        const mintingUBA = toBN(args.valueUBA);
        const poolFeeUBA = this.calculatePoolFee(toBN(args.feeUBA));
        this.reservedUBA = this.reservedUBA.add(mintingUBA).add(poolFeeUBA);
    }

    handleMintingExecuted(args: EventArgs<MintingExecuted>) {
        const mintedAmountUBA = toBN(args.mintedAmountUBA);
        const agentFeeUBA = toBN(args.agentFeeUBA);
        const poolFeeUBA = toBN(args.poolFeeUBA);
        // update underlying free balance
        this.underlyingBalanceUBA = this.underlyingBalanceUBA.add(mintedAmountUBA).add(agentFeeUBA).add(poolFeeUBA);
        // create redemption ticket
        this.mintedUBA = this.mintedUBA.add(mintedAmountUBA).add(poolFeeUBA);
        // delete collateral reservation
        const collateralReservationId = Number(args.collateralReservationId);
        if (collateralReservationId > 0) {  // collateralReservationId == 0 for self-minting
            this.reservedUBA = this.reservedUBA.sub(mintedAmountUBA).sub(poolFeeUBA);
        }
    }

    handleMintingPaymentDefault(args: EventArgs<MintingPaymentDefault>) {
        this.reservedUBA = this.reservedUBA.sub(toBN(args.reservedAmountUBA));
    }

    handleCollateralReservationDeleted(args: EventArgs<CollateralReservationDeleted>) {
        this.reservedUBA = this.reservedUBA.sub(toBN(args.reservedAmountUBA));
    }

    // handlers: redemption and self-close
    handleRedemptionRequested(args: EventArgs<RedemptionRequested>): void {
        this.mintedUBA = this.mintedUBA.sub(toBN(args.valueUBA));
        this.updateRedeemingUBA(args.requestId, toBN(args.valueUBA));
    }

    handleRedemptionPerformed(args: EventArgs<RedemptionPerformed>): void {
        this.updateRedeemingUBA(args.requestId, toBN(args.redemptionAmountUBA).neg());
        this.underlyingBalanceUBA = this.underlyingBalanceUBA.sub(args.spentUnderlyingUBA);
    }

    handleRedemptionPaymentFailed(args: EventArgs<RedemptionPaymentFailed>): void {
        this.underlyingBalanceUBA = this.underlyingBalanceUBA.sub(args.spentUnderlyingUBA);
    }

    handleRedemptionPaymentBlocked(args: EventArgs<RedemptionPaymentBlocked>): void {
        this.updateRedeemingUBA(args.requestId, toBN(args.redemptionAmountUBA).neg());
        this.underlyingBalanceUBA = this.underlyingBalanceUBA.sub(args.spentUnderlyingUBA);
    }

    handleRedemptionDefault(args: EventArgs<RedemptionDefault>): void {
        this.updateRedeemingUBA(args.requestId, toBN(args.redemptionAmountUBA).neg());
    }

    handleRedeemedInCollateral(args: EventArgs<RedeemedInCollateral>): void {
        this.mintedUBA = this.mintedUBA.sub(toBN(args.redemptionAmountUBA));
    }

    handleSelfClose(args: EventArgs<SelfClose>): void {
        this.mintedUBA = this.mintedUBA.sub(toBN(args.valueUBA));
    }

    private updateRedeemingUBA(requestId: BNish, valueUBA: BN) {
        this.redeemingUBA = this.redeemingUBA.add(valueUBA);
        if (!this.isPoolSelfCloseRedemption(requestId)) {
            this.poolRedeemingUBA = this.poolRedeemingUBA.add(valueUBA);
        }
    }

    protected isPoolSelfCloseRedemption(requestId: BNish) {
        return !toBN(requestId).and(BN_ONE).isZero();
    }

    // handlers: liquidation
    handleLiquidationPerformed(args: EventArgs<LiquidationPerformed>): void {
        this.mintedUBA = this.mintedUBA.sub(toBN(args.valueUBA));
    }

    // handlers: underlying withdrawal
    handleUnderlyingWithdrawalAnnounced(args: EventArgs<UnderlyingWithdrawalAnnounced>): void {
        this.announcedUnderlyingWithdrawalId = args.announcementId;
    }

    handleUnderlyingWithdrawalConfirmed(args: EventArgs<UnderlyingWithdrawalConfirmed>): void {
        this.underlyingBalanceUBA = this.underlyingBalanceUBA.sub(args.spentUBA);
        this.announcedUnderlyingWithdrawalId = BN_ZERO;
    }

    handleUnderlyingWithdrawalCancelled(): void {
        this.announcedUnderlyingWithdrawalId = BN_ZERO;
    }

    handleUnderlyingBalanceToppedUp(args: EventArgs<UnderlyingBalanceToppedUp>): void {
        this.underlyingBalanceUBA = this.underlyingBalanceUBA.add(args.depositedUBA);
    }

    // handlers: agent availability
    handleAgentAvailable(args: EventArgs<AgentAvailable>) {
        this.publiclyAvailable = true;
        Object.defineProperty(this.agentSettings, 'mintingVaultCollateralRatioBIPS', toBN(args.mintingVaultCollateralRatioBIPS));
        Object.defineProperty(this.agentSettings, 'mintingPoolCollateralRatioBIPS', toBN(args.mintingPoolCollateralRatioBIPS));
        Object.defineProperty(this.agentSettings, 'feeBIPS', toBN(args.feeBIPS));
    }

    handleAvailableAgentExited() {
        this.publiclyAvailable = false;
    }

    // handlers: dust
    handleDustChanged(args: EventArgs<DustChanged>): void {
        this.dustUBA = args.dustUBA;
    }

    // agent state changing
    depositVaultCollateral(token: string, value: BN): void {
        this.totalVaultCollateralWei[token] = this.totalVaultCollateralWei[token] ? this.totalVaultCollateralWei[token].add(value) : value;
    }

    withdrawVaultCollateral(token: string, value: BN): void {
        this.totalVaultCollateralWei[token] = this.totalVaultCollateralWei[token].sub(value);
    }

    // agent state changing
    depositPoolCollateral(value: BN): void {
        this.totalPoolCollateralNATWei = this.totalPoolCollateralNATWei.add(value);
    }

    withdrawPoolCollateral(value: BN): void {
        this.totalPoolCollateralNATWei = this.totalPoolCollateralNATWei.sub(value);
    }

    handleAgentSettingChanged(name: string, value: string | BN): void {
        (this.agentSettings as any)[name] = web3Normalize(value);
    }

    collateralBalance(collateral: CollateralType) {
        return Number(collateral.collateralClass) === CollateralClass.VAULT ? this.totalVaultCollateralWei[this.agentSettings.vaultCollateralToken] : this.totalPoolCollateralNATWei;
    }

    private collateralRatioForPriceBIPS(prices: Prices, collateral: CollateralType) {
        const redeemingUBA = Number(collateral.collateralClass) === CollateralClass.VAULT ? this.redeemingUBA : this.poolRedeemingUBA;
        const totalUBA = this.reservedUBA.add(this.mintedUBA).add(redeemingUBA);
        if (totalUBA.isZero()) return MAX_UINT256;
        const price = prices.get(collateral);
        const backingCollateralWei = price.convertUBAToTokenWei(totalUBA);
        const totalCollateralWei = this.collateralBalance(collateral);
        return totalCollateralWei.muln(MAX_BIPS).div(backingCollateralWei);
    }

    collateralRatioBIPS(collateral: CollateralType) {
        const ratio = this.collateralRatioForPriceBIPS(this.parent.prices, collateral);
        const ratioFromTrusted = this.collateralRatioForPriceBIPS(this.parent.trustedPrices, collateral);
        return maxBN(ratio, ratioFromTrusted);
    }


    private possibleLiquidationTransitionForCollateral(collateral: CollateralType, timestamp: BN) {
        const cr = this.collateralRatioBIPS(collateral);
        const settings = this.parent.settings;
        if (this.status === AgentStatus.NORMAL) {
            if (cr.lt(toBN(collateral.ccbMinCollateralRatioBIPS))) {
                return AgentStatus.LIQUIDATION;
            } else if (cr.lt(toBN(collateral.minCollateralRatioBIPS))) {
                return AgentStatus.CCB;
            }
        } else if (this.status === AgentStatus.CCB) {
            if (cr.gte(toBN(collateral.minCollateralRatioBIPS))) {
                return AgentStatus.NORMAL;
            } else if (cr.lt(toBN(collateral.ccbMinCollateralRatioBIPS)) || timestamp.gte(this.ccbStartTimestamp.add(toBN(settings.ccbTimeSeconds)))) {
                return AgentStatus.LIQUIDATION;
            }
        } else if (this.status === AgentStatus.LIQUIDATION) {
            if (cr.gte(toBN(collateral.safetyMinCollateralRatioBIPS))) {
                return AgentStatus.NORMAL;
            }
        }
        return this.status;
    }

    possibleLiquidationTransition(timestamp: BN) {
        const vaultTransition = this.possibleLiquidationTransitionForCollateral(this.parent.collaterals.get(CollateralClass.VAULT, this.agentSettings.vaultCollateralToken), timestamp);
        const poolTransition = this.possibleLiquidationTransitionForCollateral(this.parent.collaterals.get(CollateralClass.POOL, this.parent.poolWNatCollateral.token), timestamp);
        // return the higher status (more severe)
        return vaultTransition >= poolTransition ? vaultTransition : poolTransition;
    }

    calculatePoolFee(mintingFeeUBA: BN) {
        return roundUBAToAmg(this.parent.settings, toBN(mintingFeeUBA).mul(toBN(this.agentSettings.poolFeeShareBIPS)).divn(MAX_BIPS));
    }
}
