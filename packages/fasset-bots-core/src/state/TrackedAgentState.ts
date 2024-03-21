import BN from "bn.js";
import { AgentInfo, AgentStatus, CollateralType, CollateralClass } from "../fasset/AssetManagerTypes";
import { BN_ONE, BN_ZERO, BNish, MAX_BIPS, MAX_UINT256, maxBN, toBN } from "../utils/helpers";
import { TrackedState } from "./TrackedState";
import { EventArgs } from "../utils/events/common";
import { AgentAvailable, AgentCollateralTypeChanged, CollateralReservationDeleted, CollateralReserved, DustChanged, LiquidationPerformed, MintingExecuted, MintingPaymentDefault, RedemptionDefault, RedemptionPaymentBlocked, RedemptionPaymentFailed, RedemptionPerformed, RedemptionRequested, SelfClose, UnderlyingBalanceToppedUp, UnderlyingWithdrawalAnnounced, UnderlyingWithdrawalConfirmed } from "../../typechain-truffle/AssetManagerController";
import { web3Normalize } from "../utils/web3normalize";
import { Prices } from "./Prices";
import { AgentVaultCreated, RedeemedInCollateral } from "../../typechain-truffle/AssetManager";
import { roundUBAToAmg } from "../fasset/Conversions";
import { logger } from "../utils/logger";
import { formatArgs } from "../utils/formatting";

export type InitialAgentData = EventArgs<AgentVaultCreated>;

export class TrackedAgentState {
    static deepCopyWithObjectCreate = true;

    constructor(
        public parent: TrackedState,
        data: InitialAgentData
    ) {
        this.vaultAddress = data.agentVault;
        this.underlyingAddress = data.underlyingAddress;
        this.collateralPoolAddress = data.collateralPool;
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
    collateralPoolAddress: string;

    //status
    status = AgentStatus.NORMAL;
    publiclyAvailable: boolean = false;

    //state
    totalVaultCollateralWei: { [key: string]: BN } = {};
    totalPoolCollateralNATWei: BN = BN_ZERO;
    ccbStartTimestamp: BN = BN_ZERO; // 0 - not in ccb/liquidation
    liquidationStartTimestamp: BN = BN_ZERO; // 0 - not in liquidation
    announcedUnderlyingWithdrawalId: BN = BN_ZERO; // 0 - not announced

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
        poolTopupTokenPriceFactorBIPS: BN_ZERO,
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
        logger.info(`Tracked State Agent initialized with info ${formatArgs(agentInfo)}.`);
    }

    handleStatusChange(status: AgentStatus, timestamp?: BN): void {
        if (timestamp && this.status === AgentStatus.NORMAL && status === AgentStatus.CCB) {
            this.ccbStartTimestamp = timestamp;
        }
        if (
            timestamp &&
            (this.status === AgentStatus.NORMAL || this.status === AgentStatus.CCB) &&
            (status === AgentStatus.LIQUIDATION || status === AgentStatus.FULL_LIQUIDATION)
        ) {
            this.liquidationStartTimestamp = timestamp;
        }
        this.status = status;
        logger.info(`Tracked State Agent changed status: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    // handlers: minting
    handleCollateralReserved(args: EventArgs<CollateralReserved>) {
        const mintingUBA = toBN(args.valueUBA);
        const poolFeeUBA = this.calculatePoolFee(toBN(args.feeUBA));
        this.reservedUBA = this.reservedUBA.add(mintingUBA).add(poolFeeUBA);
        logger.info(`Tracked State Agent handled collateral reservation: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
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
        if (collateralReservationId > 0) {
            // collateralReservationId == 0 for self-minting
            this.reservedUBA = this.reservedUBA.sub(mintedAmountUBA).sub(poolFeeUBA);
        }
        logger.info(`Tracked State Agent handled minting executed: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    handleMintingPaymentDefault(args: EventArgs<MintingPaymentDefault>) {
        this.reservedUBA = this.reservedUBA.sub(toBN(args.reservedAmountUBA));
        logger.info(`Tracked State Agent handled minting payment default: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    handleCollateralReservationDeleted(args: EventArgs<CollateralReservationDeleted>) {
        this.reservedUBA = this.reservedUBA.sub(toBN(args.reservedAmountUBA));
        logger.info(`Tracked State Agent handled collateral reservation deleted: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    // handlers: redemption and self-close
    handleRedemptionRequested(args: EventArgs<RedemptionRequested>): void {
        this.mintedUBA = this.mintedUBA.sub(toBN(args.valueUBA));
        this.updateRedeemingUBA(args.requestId, toBN(args.valueUBA));
        logger.info(`Tracked State Agent handled redemption requested: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    handleRedemptionPerformed(args: EventArgs<RedemptionPerformed>): void {
        this.updateRedeemingUBA(args.requestId, toBN(args.redemptionAmountUBA).neg());
        this.underlyingBalanceUBA = this.underlyingBalanceUBA.sub(args.spentUnderlyingUBA);
        logger.info(`Tracked State Agent handled redemption performed: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    handleRedemptionPaymentFailed(args: EventArgs<RedemptionPaymentFailed>): void {
        this.underlyingBalanceUBA = this.underlyingBalanceUBA.sub(args.spentUnderlyingUBA);
        logger.info(`Tracked State Agent handled redemption payment failed: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    handleRedemptionPaymentBlocked(args: EventArgs<RedemptionPaymentBlocked>): void {
        this.updateRedeemingUBA(args.requestId, toBN(args.redemptionAmountUBA).neg());
        this.underlyingBalanceUBA = this.underlyingBalanceUBA.sub(args.spentUnderlyingUBA);
        logger.info(`Tracked State Agent handled redemption payment blocked: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    handleRedemptionDefault(args: EventArgs<RedemptionDefault>): void {
        this.updateRedeemingUBA(args.requestId, toBN(args.redemptionAmountUBA).neg());
        logger.info(`Tracked State Agent handled redemption default: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    handleRedeemedInCollateral(args: EventArgs<RedeemedInCollateral>): void {
        this.mintedUBA = this.mintedUBA.sub(toBN(args.redemptionAmountUBA));
        logger.info(`Tracked State Agent handled redeemed in collateral: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    handleSelfClose(args: EventArgs<SelfClose>): void {
        this.mintedUBA = this.mintedUBA.sub(toBN(args.valueUBA));
        logger.info(`Tracked State Agent handled self close: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
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
        logger.info(`Tracked State Agent handled liquidation performed: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    // handlers: collateral changed
    handleAgentCollateralTypeChanged(args: EventArgs<AgentCollateralTypeChanged>): void {
        this.agentSettings.vaultCollateralToken = args.token;
    }

    // handlers: underlying withdrawal
    handleUnderlyingWithdrawalAnnounced(args: EventArgs<UnderlyingWithdrawalAnnounced>): void {
        this.announcedUnderlyingWithdrawalId = args.announcementId;
        logger.info(`Tracked State Agent handled underlying withdrawal announced: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    handleUnderlyingWithdrawalConfirmed(args: EventArgs<UnderlyingWithdrawalConfirmed>): void {
        this.underlyingBalanceUBA = this.underlyingBalanceUBA.sub(args.spentUBA);
        this.announcedUnderlyingWithdrawalId = BN_ZERO;
        logger.info(`Tracked State Agent handled underlying withdrawal confirmed: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    handleUnderlyingWithdrawalCancelled(): void {
        this.announcedUnderlyingWithdrawalId = BN_ZERO;
        logger.info(`Tracked State Agent handled underlying withdrawal cancelled: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    handleUnderlyingBalanceToppedUp(args: EventArgs<UnderlyingBalanceToppedUp>): void {
        this.underlyingBalanceUBA = this.underlyingBalanceUBA.add(args.depositedUBA);
        logger.info(`Tracked State Agent handled underlying balance topped up: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    // handlers: agent availability
    handleAgentAvailable(args: EventArgs<AgentAvailable>) {
        this.publiclyAvailable = true;
        Object.defineProperty(this.agentSettings, "mintingVaultCollateralRatioBIPS", toBN(args.mintingVaultCollateralRatioBIPS));
        Object.defineProperty(this.agentSettings, "mintingPoolCollateralRatioBIPS", toBN(args.mintingPoolCollateralRatioBIPS));
        Object.defineProperty(this.agentSettings, "feeBIPS", toBN(args.feeBIPS));
        logger.info(`Tracked State Agent handled agent available: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    handleAvailableAgentExited() {
        this.publiclyAvailable = false;
        logger.info(`Tracked State Agent handled agent exited available: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    // handlers: dust
    handleDustChanged(args: EventArgs<DustChanged>): void {
        this.dustUBA = args.dustUBA;
        logger.info(`Tracked State Agent handled dust changed: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    // agent state changing
    depositVaultCollateral(token: string, value: BN): void {
        this.totalVaultCollateralWei[token] = this.totalVaultCollateralWei[token] ? this.totalVaultCollateralWei[token].add(value) : value;
        logger.info(`Tracked State Agent handled vault collateral deposited: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    withdrawVaultCollateral(token: string, value: BN): void {
        this.totalVaultCollateralWei[token] = this.totalVaultCollateralWei[token].sub(value);
        logger.info(`Tracked State Agent handled vault collateral withdrawal: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    // agent state changing
    depositPoolCollateral(value: BN): void {
        this.totalPoolCollateralNATWei = this.totalPoolCollateralNATWei.add(value);
        logger.info(`Tracked State Agent handled pool collateral deposited: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    withdrawPoolCollateral(value: BN): void {
        this.totalPoolCollateralNATWei = this.totalPoolCollateralNATWei.sub(value);
        logger.info(`Tracked State Agent handled pool collateral withdrawal: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    handleAgentSettingChanged(name: string, value: string | BN): void {
        (this.agentSettings as any)[name] = web3Normalize(value);
        logger.info(`Tracked State Agent handled agent setting changed: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    collateralBalance(collateral: CollateralType): BN {
        return Number(collateral.collateralClass) === CollateralClass.VAULT
            ? this.totalVaultCollateralWei[this.agentSettings.vaultCollateralToken]
            : this.totalPoolCollateralNATWei;
    }

    private collateralRatioForPriceBIPS(prices: Prices, collateral: CollateralType): BN {
        const redeemingUBA = Number(collateral.collateralClass) === CollateralClass.VAULT ? this.redeemingUBA : this.poolRedeemingUBA;
        const totalUBA = this.reservedUBA.add(this.mintedUBA).add(redeemingUBA);
        if (totalUBA.isZero()) return MAX_UINT256;
        const price = prices.get(collateral);
        const backingCollateralWei = price.convertUBAToTokenWei(totalUBA);
        const totalCollateralWei = this.collateralBalance(collateral);
        return totalCollateralWei.muln(MAX_BIPS).div(backingCollateralWei);
    }

    collateralRatioBIPS(collateral: CollateralType): BN {
        const ratio = this.collateralRatioForPriceBIPS(this.parent.prices, collateral);
        const ratioFromTrusted = this.collateralRatioForPriceBIPS(this.parent.trustedPrices, collateral);
        return maxBN(ratio, ratioFromTrusted);
    }

    private possibleLiquidationTransitionForCollateral(collateral: CollateralType, timestamp: BN): AgentStatus {
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
        const vaultTransition = this.possibleLiquidationTransitionForCollateral(
            this.parent.collaterals.get(CollateralClass.VAULT, this.agentSettings.vaultCollateralToken),
            timestamp
        );
        const poolTransition = this.possibleLiquidationTransitionForCollateral(
            this.parent.collaterals.get(CollateralClass.POOL, this.parent.poolWNatCollateral.token),
            timestamp
        );
        // return the higher status (more severe)
        logger.info(`Tracked State Agent handled possible liquidation transition; vaultTransition: ${vaultTransition}, poolTransition: ${poolTransition}.`);
        return vaultTransition >= poolTransition ? vaultTransition : poolTransition;
    }

    calculatePoolFee(mintingFeeUBA: BN): BN {
        return roundUBAToAmg(this.parent.settings, toBN(mintingFeeUBA).mul(toBN(this.agentSettings.poolFeeShareBIPS)).divn(MAX_BIPS));
    }

    getTrackedStateAgentSettings() {
        return {
            vaultAddress: this.vaultAddress,
            underlyingAddress: this.underlyingAddress,
            collateralPoolAddress: this.collateralPoolAddress,
            vaultCollateralToken: this.agentSettings.vaultCollateralToken,
            feeBIPS: this.agentSettings.feeBIPS,
            poolFeeShareBIPS: this.agentSettings.poolFeeShareBIPS,
            mintingVaultCollateralRatioBIPS: this.agentSettings.mintingVaultCollateralRatioBIPS,
            mintingPoolCollateralRatioBIPS: this.agentSettings.mintingPoolCollateralRatioBIPS,
            poolExitCollateralRatioBIPS: this.agentSettings.poolExitCollateralRatioBIPS,
            buyFAssetByAgentFactorBIPS: this.agentSettings.buyFAssetByAgentFactorBIPS,
            poolTopupCollateralRatioBIPS: this.agentSettings.poolTopupCollateralRatioBIPS,
            poolTopupTokenPriceFactorBIPS: this.agentSettings.poolTopupTokenPriceFactorBIPS,
            status: this.status,
            publiclyAvailable: this.publiclyAvailable,
            totalVaultCollateralWei: this.totalVaultCollateralWei,
            totalPoolCollateralNATWei: this.totalPoolCollateralNATWei,
            ccbStartTimestamp: this.ccbStartTimestamp,
            liquidationStartTimestamp: this.liquidationStartTimestamp,
            announcedUnderlyingWithdrawalId: this.announcedUnderlyingWithdrawalId,
            reservedUBA: this.reservedUBA,
            mintedUBA: this.mintedUBA,
            redeemingUBA: this.redeemingUBA,
            poolRedeemingUBA: this.poolRedeemingUBA,
            dustUBA: this.dustUBA,
            underlyingBalanceUBA: this.underlyingBalanceUBA,
        };
    }
}
