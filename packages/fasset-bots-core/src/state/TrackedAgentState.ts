import BN from "bn.js";
import { AgentAvailable, AgentCollateralTypeChanged, CollateralReservationDeleted, CollateralReserved, DustChanged, LiquidationPerformed, MintingExecuted, MintingPaymentDefault, RedemptionDefault, RedemptionPaymentBlocked, RedemptionPaymentFailed, RedemptionPerformed, RedemptionRequested, SelfClose, UnderlyingBalanceToppedUp, UnderlyingWithdrawalAnnounced, UnderlyingWithdrawalConfirmed } from "../../typechain-truffle/AssetManagerController";
import { AgentVaultCreated, RedeemedInCollateral, SelfMint } from "../../typechain-truffle/IIAssetManager";
import { AgentInfo, AgentStatus, CollateralClass, CollateralType } from "../fasset/AssetManagerTypes";
import { roundUBAToAmg } from "../fasset/Conversions";
import { EventArgs } from "../utils/events/common";
import { formatArgs } from "../utils/formatting";
import { BN_ONE, BN_ZERO, BNish, MAX_BIPS, MAX_UINT256, maxBN, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { web3Normalize } from "../utils/web3normalize";
import { Prices } from "./Prices";
import { TrackedState } from "./TrackedState";

export type InitialAgentData = EventArgs<AgentVaultCreated>;

export class TrackedAgentState {
    static deepCopyWithObjectCreate = true;

    constructor(
        public parent: TrackedState,
        data: InitialAgentData
    ) {
        this.vaultAddress = data.agentVault;
        this.underlyingAddress = data.creationData.underlyingAddress;
        this.collateralPoolAddress = data.creationData.collateralPool;
        this.collateralPoolTokenAddress = data.creationData.collateralPoolToken;
        this.agentSettings.vaultCollateralToken = data.creationData.vaultCollateralToken;
        this.agentSettings.feeBIPS = toBN(data.creationData.feeBIPS);
        this.agentSettings.poolFeeShareBIPS = toBN(data.creationData.poolFeeShareBIPS);
        this.agentSettings.mintingVaultCollateralRatioBIPS = toBN(data.creationData.mintingVaultCollateralRatioBIPS);
        this.agentSettings.mintingPoolCollateralRatioBIPS = toBN(data.creationData.mintingPoolCollateralRatioBIPS);
        this.agentSettings.poolExitCollateralRatioBIPS = toBN(data.creationData.poolExitCollateralRatioBIPS);
        this.agentSettings.buyFAssetByAgentFactorBIPS = toBN(data.creationData.buyFAssetByAgentFactorBIPS);
        this.agentSettings.poolTopupCollateralRatioBIPS = toBN(data.creationData.poolTopupCollateralRatioBIPS);
        this.agentSettings.poolTopupTokenPriceFactorBIPS = toBN(data.creationData.poolTopupTokenPriceFactorBIPS);
        this.agentSettings.handshakeType = toBN(data.creationData.handshakeType);
        this.totalVaultCollateralWei[this.agentSettings.vaultCollateralToken] = BN_ZERO;
    }

    // identifying addresses
    vaultAddress: string;
    underlyingAddress: string;
    collateralPoolAddress: string;
    collateralPoolTokenAddress: string;

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
        handshakeType: BN_ZERO
    };

    // aggregates
    reservedUBA: BN = BN_ZERO;
    mintedUBA: BN = BN_ZERO;
    redeemingUBA: BN = BN_ZERO;
    poolRedeemingUBA: BN = BN_ZERO;
    dustUBA: BN = BN_ZERO;
    underlyingBalanceUBA: BN = BN_ZERO;

    // safeguard metadata
    initBlock: number | null = null; // block at which the initial agent info was fetch at

    // calculated getters
    get requiredUnderlyingBalanceUBA(): BN {
        const backedUBA = this.mintedUBA.add(this.redeemingUBA);
        return backedUBA.mul(toBN(this.parent.settings.minUnderlyingBackingBIPS)).divn(MAX_BIPS);
    }

    get freeUnderlyingBalanceUBA(): BN {
        return this.underlyingBalanceUBA.sub(this.requiredUnderlyingBalanceUBA);
    }

    initialize(agentInfo: AgentInfo, initBlock: number | null = null): void {
        this.initBlock = initBlock;
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
        this.agentSettings.handshakeType = toBN(agentInfo.handshakeType);
        logger.info(`Tracked State Agent initialized with info ${formatArgs(agentInfo)}.`);
    }

    handleStatusChange(status: AgentStatus, timestamp?: BN): void {
        const ccbStarted = this.status === AgentStatus.NORMAL && status === AgentStatus.CCB;
        if (timestamp && ccbStarted) {
            this.ccbStartTimestamp = timestamp;
        }
        const liquidationStarted = (this.status === AgentStatus.NORMAL || this.status === AgentStatus.CCB) &&
            (status === AgentStatus.LIQUIDATION || status === AgentStatus.FULL_LIQUIDATION);
        if (timestamp && liquidationStarted) {
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

    handleSelfMint(args: EventArgs<SelfMint>) {
        const mintedAmountUBA = toBN(args.mintedAmountUBA);
        const poolFeeUBA = toBN(args.poolFeeUBA);
        const depositedAmountUBA = toBN(args.depositedAmountUBA)
        // update underlying free balance
        this.underlyingBalanceUBA = this.underlyingBalanceUBA.add(depositedAmountUBA);
        // create redemption ticket
        this.mintedUBA = this.mintedUBA.add(mintedAmountUBA).add(poolFeeUBA);
        logger.info(`Tracked State Agent handled self minting: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
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
        if (this.totalVaultCollateralWei[token] == null) return; // in case of wnat transfer at agent vault destroy
        this.totalVaultCollateralWei[token] = this.totalVaultCollateralWei[token] ? this.totalVaultCollateralWei[token].add(value) : value;
        logger.info(`Tracked State Agent handled vault collateral deposited: ${formatArgs(this.getTrackedStateAgentSettings())}.`);
    }

    withdrawVaultCollateral(token: string, value: BN): void {
        if (this.totalVaultCollateralWei[token] == null) return; // in case of wnat transfer at agent vault destroy
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

    isCollateralValid(collateral: CollateralType, timestamp: BN) {
        const validUntil = toBN(collateral.validUntil);
        return validUntil.eq(BN_ZERO) || validUntil.gte(timestamp);
    }

    collateralRatioBIPS(collateral: CollateralType, timestamp: BN): BN {
        if (!this.isCollateralValid(collateral, timestamp)) {
            return BN_ZERO;
        }
        const ratio = this.collateralRatioForPriceBIPS(this.parent.prices, collateral);
        const ratioFromTrusted = this.collateralRatioForPriceBIPS(this.parent.trustedPrices, collateral);
        return maxBN(ratio, ratioFromTrusted);
    }

    private possibleLiquidationTransitionForCollateral(collateral: CollateralType, timestamp: BN): AgentStatus {
        const cr = this.collateralRatioBIPS(collateral, timestamp);
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
        return vaultTransition >= poolTransition ? vaultTransition : poolTransition;
    }

    // should start the CCB liquidation countdown
    candidateForCcbRegister(timestamp: BN): boolean {
        if (this.status >= AgentStatus.CCB) {
            // already registered or in liquidation
            return false
        }
        const calculatedStatus = this.possibleLiquidationTransition(timestamp);
        return calculatedStatus === AgentStatus.CCB;
    }

    // should liquidate the agent already registered for CCB
    candidateForCcbLiquidation(timestamp: BN): boolean {
        return this.status === AgentStatus.CCB && timestamp.gte(this.ccbStartTimestamp.add(toBN(this.parent.settings.ccbTimeSeconds)));
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
            handshakeType: this.agentSettings.handshakeType,
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
