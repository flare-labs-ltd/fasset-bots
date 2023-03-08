import BN from "bn.js";
import { AgentStatus } from "../actors/AgentBot";
import { AgentInfo } from "../fasset/AssetManagerTypes";
import { BN_ZERO, MAX_BIPS, MAX_UINT256, toBN } from "../utils/helpers";
import { Prices } from "./Prices";
import { convertUBAToNATWei } from "../fasset/Conversions";
import { TrackedState } from "./TrackedState";
import { EventArgs } from "../utils/events/common";
import { AgentAvailable, CollateralReservationDeleted, CollateralReserved, DustChanged, LiquidationPerformed, MintingExecuted, MintingPaymentDefault, RedemptionDefault, RedemptionFinished, RedemptionPaymentBlocked, RedemptionPerformed, RedemptionRequested, SelfClose, UnderlyingWithdrawalAnnounced, UnderlyingWithdrawalConfirmed } from "../../typechain-truffle/AssetManagerController";

export class TrackedAgentState {
    constructor(
        public parent: TrackedState,
        public vaultAddress: string,
        public ownerAddress: string,
        public underlyingAddress: string
    ) { }

    status = AgentStatus.NORMAL;
    publiclyAvailable: boolean = false;
    feeBIPS: BN = BN_ZERO;
    agentMinCollateralRatioBIPS: BN = BN_ZERO;
    totalCollateralNATWei: BN = BN_ZERO;
    ccbStartTimestamp: BN = BN_ZERO;                // 0 - not in ccb/liquidation
    liquidationStartTimestamp: BN = BN_ZERO;        // 0 - not in liquidation
    announcedUnderlyingWithdrawalId: BN = BN_ZERO;  // 0 - not announced


    // aggregates
    reservedUBA: BN = BN_ZERO;
    mintedUBA: BN = BN_ZERO;
    redeemingUBA: BN = BN_ZERO;
    dustUBA: BN = BN_ZERO;
    freeUnderlyingBalanceUBA: BN = BN_ZERO;

    initialize(agentInfo: AgentInfo): void {
        this.status = Number(agentInfo.status);
        this.publiclyAvailable = agentInfo.publiclyAvailable;
        this.feeBIPS = toBN(agentInfo.feeBIPS);
        this.agentMinCollateralRatioBIPS = toBN(agentInfo.agentMinCollateralRatioBIPS);
        this.totalCollateralNATWei = toBN(agentInfo.totalCollateralNATWei);
        this.ccbStartTimestamp = toBN(agentInfo.ccbStartTimestamp);
        this.liquidationStartTimestamp = toBN(agentInfo.liquidationStartTimestamp);
        this.announcedUnderlyingWithdrawalId = toBN(agentInfo.announcedUnderlyingWithdrawalId);
        this.reservedUBA = toBN(agentInfo.reservedUBA);
        this.mintedUBA = toBN(agentInfo.mintedUBA);
        this.redeemingUBA = toBN(agentInfo.redeemingUBA);
        this.dustUBA = toBN(agentInfo.dustUBA);
        this.freeUnderlyingBalanceUBA = toBN(agentInfo.freeUnderlyingBalanceUBA);
    }

    async possibleLiquidationTransition(timestamp: BN): Promise<number> {
        const cr = await this.collateralRatioBIPS();
        const agentStatus = this.status;
        const settings = this.parent.settings;
        if (agentStatus === AgentStatus.NORMAL) {
            if (cr.lt(toBN(settings.ccbMinCollateralRatioBIPS))) {
                return AgentStatus.LIQUIDATION;
            } else if (cr.lt(toBN(settings.minCollateralRatioBIPS))) {
                return AgentStatus.CCB;
            }
        } else if (agentStatus === AgentStatus.CCB) {
            if (cr.gte(toBN(settings.minCollateralRatioBIPS))) {
                return AgentStatus.NORMAL;
            } else if (cr.lt(toBN(settings.ccbMinCollateralRatioBIPS)) || timestamp.gte(this.ccbStartTimestamp.add(toBN(settings.ccbTimeSeconds)))) {
                return AgentStatus.LIQUIDATION;
            }
        } else if (agentStatus === AgentStatus.LIQUIDATION) {
            if (cr.gte(toBN(settings.safetyMinCollateralRatioBIPS))) {
                return AgentStatus.NORMAL;
            }
        }
        return agentStatus;
    }

    async collateralRatioBIPS(): Promise<BN> {
        const ratio = this.collateralRatioForPriceBIPS(this.parent.prices);
        const ratioFromTrusted = this.collateralRatioForPriceBIPS(this.parent.trustedPrices);
        return BN.max(ratio, ratioFromTrusted);
    }

    private collateralRatioForPriceBIPS(prices: Prices) {
        const totalUBA = this.reservedUBA.add(this.mintedUBA).add(this.redeemingUBA);
        if (totalUBA.isZero()) return MAX_UINT256;
        const backingCollateral: BN = convertUBAToNATWei(this.parent.settings, totalUBA, prices.amgNatWei);
        return this.totalCollateralNATWei.muln(MAX_BIPS).div(backingCollateral);
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
        this.reservedUBA = this.reservedUBA.add(toBN(args.valueUBA));
    }

    handleMintingExecuted(args: EventArgs<MintingExecuted>) {
        // update underlying free balance
        this.freeUnderlyingBalanceUBA = this.freeUnderlyingBalanceUBA.add(toBN(args.receivedFeeUBA));
        // create redemption ticket
        this.mintedUBA = this.mintedUBA.add(toBN(args.mintedAmountUBA));
        // delete collateral reservation
        const collateralReservationId = Number(args.collateralReservationId);
        if (collateralReservationId > 0) {  // collateralReservationId == 0 for self-minting
            this.reservedUBA = this.reservedUBA.sub(toBN(args.mintedAmountUBA));
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
        this.redeemingUBA = this.redeemingUBA.add(toBN(args.valueUBA));
    }

    handleRedemptionPerformed(args: EventArgs<RedemptionPerformed>): void {
        this.redeemingUBA = this.redeemingUBA.sub(toBN(args.valueUBA));
    }

    handleRedemptionPaymentBlocked(args: EventArgs<RedemptionPaymentBlocked>): void {
        this.redeemingUBA = this.redeemingUBA.sub(toBN(args.redemptionAmountUBA));
    }

    handleRedemptionDefault(args: EventArgs<RedemptionDefault>): void {
        this.redeemingUBA = this.redeemingUBA.sub(toBN(args.redemptionAmountUBA));
    }

    handleRedemptionFinished(args: EventArgs<RedemptionFinished>): void {
        this.freeUnderlyingBalanceUBA = this.freeUnderlyingBalanceUBA.add(toBN(args.freedUnderlyingBalanceUBA));
    }

    handleSelfClose(args: EventArgs<SelfClose>): void {
        this.mintedUBA = this.mintedUBA.sub(toBN(args.valueUBA));
        this.freeUnderlyingBalanceUBA = this.freeUnderlyingBalanceUBA.add(toBN(args.valueUBA));
    }

    // handlers: liquidation
    handleLiquidationPerformed(args: EventArgs<LiquidationPerformed>): void {
        this.mintedUBA = this.mintedUBA.sub(toBN(args.valueUBA));
        this.freeUnderlyingBalanceUBA = this.freeUnderlyingBalanceUBA.add(toBN(args.valueUBA));
    }

    // handlers: underlying withdrawal
    handleUnderlyingWithdrawalAnnounced(args: EventArgs<UnderlyingWithdrawalAnnounced>): void {
        this.announcedUnderlyingWithdrawalId = args.announcementId;
    }

    handleUnderlyingWithdrawalConfirmed(args: EventArgs<UnderlyingWithdrawalConfirmed>): void {
        this.freeUnderlyingBalanceUBA = this.freeUnderlyingBalanceUBA.add(toBN(args.spentUBA).neg());
        this.announcedUnderlyingWithdrawalId = BN_ZERO;
    }

    handleUnderlyingWithdrawalCancelled(): void {
        this.announcedUnderlyingWithdrawalId = BN_ZERO;
    }

    // handlers: agent availability
    handleAgentAvailable(args: EventArgs<AgentAvailable>) {
        this.publiclyAvailable = true;
        this.agentMinCollateralRatioBIPS = toBN(args.agentMinCollateralRatioBIPS);
        this.feeBIPS = toBN(args.feeBIPS);
    }

    handleAvailableAgentExited() {
        this.publiclyAvailable = false;
    }

    // handlers: dust
    handleDustChanged(args: EventArgs<DustChanged>): void {
        this.dustUBA = args.dustUBA;
    }

    // agent state changing
    depositCollateral(value: BN) {
        this.totalCollateralNATWei = this.totalCollateralNATWei.add(value);
    }

    withdrawCollateral(value: BN) {
        this.totalCollateralNATWei = this.totalCollateralNATWei.sub(value);
    }

}