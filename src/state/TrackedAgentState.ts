import BN from "bn.js";
import { AgentStatus } from "../actors/AgentBot";
import { AgentInfo, CollateralTokenClass } from "../fasset/AssetManagerTypes";
import { BN_ZERO, MAX_BIPS, MAX_UINT256, toBN, requireNotNull } from "../utils/helpers";
import { convertUBAToTokenWei } from "../fasset/Conversions";
import { TrackedState } from "./TrackedState";
import { EventArgs } from "../utils/events/common";
import { AgentAvailable, CollateralReservationDeleted, CollateralReserved, DustChanged, LiquidationPerformed, MintingExecuted, MintingPaymentDefault, RedemptionDefault, RedemptionFinished, RedemptionPaymentBlocked, RedemptionPerformed, RedemptionRequested, SelfClose, UnderlyingWithdrawalAnnounced, UnderlyingWithdrawalConfirmed } from "../../typechain-truffle/AssetManagerController";
import { Prices } from "./Prices";

export class TrackedAgentState {
    constructor(
        public parent: TrackedState,
        public vaultAddress: string,
        public underlyingAddress: string
    ) { }

    status = AgentStatus.NORMAL;
    publiclyAvailable: boolean = false;
    totalClass1CollateralWei: { [key: string]: BN } = {};
    totalPoolCollateralNATWei: BN = BN_ZERO;
    ccbStartTimestamp: BN = BN_ZERO;                // 0 - not in ccb/liquidation
    liquidationStartTimestamp: BN = BN_ZERO;        // 0 - not in liquidation
    announcedUnderlyingWithdrawalId: BN = BN_ZERO;  // 0 - not announced

    // agent settings
    agentSettings = {
        underlyingAddressString: this.underlyingAddress,
        class1CollateralToken: "",
        feeBIPS: BN_ZERO,
        poolFeeShareBIPS: BN_ZERO,
        mintingClass1CollateralRatioBIPS: BN_ZERO,
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
    dustUBA: BN = BN_ZERO;
    freeUnderlyingBalanceUBA: BN = BN_ZERO;

    initialize(agentInfo: AgentInfo): void {
        this.status = Number(agentInfo.status);
        this.publiclyAvailable = agentInfo.publiclyAvailable;
        this.totalPoolCollateralNATWei = toBN(agentInfo.totalPoolCollateralNATWei);
        this.totalClass1CollateralWei[agentInfo.class1CollateralToken] = toBN(agentInfo.totalClass1CollateralWei);
        this.ccbStartTimestamp = toBN(agentInfo.ccbStartTimestamp);
        this.liquidationStartTimestamp = toBN(agentInfo.liquidationStartTimestamp);
        this.announcedUnderlyingWithdrawalId = toBN(agentInfo.announcedUnderlyingWithdrawalId);
        this.reservedUBA = toBN(agentInfo.reservedUBA);
        this.mintedUBA = toBN(agentInfo.mintedUBA);
        this.redeemingUBA = toBN(agentInfo.redeemingUBA);
        this.dustUBA = toBN(agentInfo.dustUBA);
        this.freeUnderlyingBalanceUBA = toBN(agentInfo.freeUnderlyingBalanceUBA);
        Object.defineProperty(this.agentSettings, 'class1CollateralToken', { value: agentInfo.class1CollateralToken });
        Object.defineProperty(this.agentSettings, 'feeBIPS', toBN(agentInfo.feeBIPS));
        Object.defineProperty(this.agentSettings, 'poolFeeShareBIPS', toBN(agentInfo.poolFeeShareBIPS));
        Object.defineProperty(this.agentSettings, 'mintingClass1CollateralRatioBIPS', toBN(agentInfo.mintingClass1CollateralRatioBIPS));
        Object.defineProperty(this.agentSettings, 'mintingPoolCollateralRatioBIPS', toBN(agentInfo.mintingPoolCollateralRatioBIPS));
        Object.defineProperty(this.agentSettings, 'poolExitCollateralRatioBIPS', toBN(agentInfo.poolExitCollateralRatioBIPS));
        Object.defineProperty(this.agentSettings, 'buyFAssetByAgentFactorBIPS', toBN(agentInfo.buyFAssetByAgentFactorBIPS));
        Object.defineProperty(this.agentSettings, 'poolTopupCollateralRatioBIPS', toBN(agentInfo.poolTopupCollateralRatioBIPS));
        Object.defineProperty(this.agentSettings, 'poolTopupTokenPriceFactorBIPS', toBN(agentInfo.poolTopupTokenPriceFactorBIPS));
    }

    async possibleLiquidationTransition(timestamp: BN): Promise<number> {
        const class1TokenSettings = requireNotNull(this.parent.context.collaterals.find(c => c.tokenClass === CollateralTokenClass.CLASS1 && c.token === this.agentSettings.class1CollateralToken));
        const natTokenSettings = requireNotNull(this.parent.context.collaterals.find(c => c.tokenClass === CollateralTokenClass.POOL));
        const crClass1 = await this.collateralRatioBIPS(class1TokenSettings.token);
        const crPool = await this.collateralRatioBIPS();
        const agentStatus = this.status;
        const settings = this.parent.settings;
        if (agentStatus === AgentStatus.NORMAL) {
            if (crClass1.lt(toBN(class1TokenSettings.ccbMinCollateralRatioBIPS)) || crPool.lt(toBN(natTokenSettings.ccbMinCollateralRatioBIPS))) {
                return AgentStatus.LIQUIDATION;
            } else if (crClass1.lt(toBN(class1TokenSettings.minCollateralRatioBIPS)) || crPool.lt(toBN(natTokenSettings.minCollateralRatioBIPS))) {
                return AgentStatus.CCB;
            }

        } else if (agentStatus === AgentStatus.CCB) {
            if (crClass1.gte(toBN(class1TokenSettings.minCollateralRatioBIPS)) && crPool.gte(toBN(natTokenSettings.minCollateralRatioBIPS))) {
                return AgentStatus.NORMAL;
            } else if (crClass1.lt(toBN(class1TokenSettings.ccbMinCollateralRatioBIPS)) || crPool.lt(toBN(natTokenSettings.ccbMinCollateralRatioBIPS)) || timestamp.gte(this.ccbStartTimestamp.add(toBN(settings.ccbTimeSeconds)))) {
                return AgentStatus.LIQUIDATION;
            }
        } else if (agentStatus === AgentStatus.LIQUIDATION) {
            if (crClass1.gte(toBN(class1TokenSettings.safetyMinCollateralRatioBIPS)) && crPool.gte(toBN(natTokenSettings.safetyMinCollateralRatioBIPS))) {
                return AgentStatus.NORMAL;
            }
        }
        return agentStatus;
    }

    async collateralRatioBIPS(tokenKey?: string): Promise<BN> {
        const ratio = this.collateralRatioForPriceBIPS(this.parent.prices, tokenKey);
        const ratioFromTrusted = this.collateralRatioForPriceBIPS(this.parent.prices, tokenKey);
        return BN.max(ratio, ratioFromTrusted);
    }

    private collateralRatioForPriceBIPS(prices: Prices, tokenKey?: string) {
        const totalUBA = this.reservedUBA.add(this.mintedUBA).add(this.redeemingUBA);
        if (totalUBA.isZero()) return MAX_UINT256;
        if (tokenKey) {
            const backingCollateral: BN = convertUBAToTokenWei(this.parent.settings, totalUBA, prices.amgToClass1Wei[this.agentSettings.class1CollateralToken]);
            return this.totalClass1CollateralWei[tokenKey].muln(MAX_BIPS).div(backingCollateral);
        } else {
            const backingCollateral: BN = convertUBAToTokenWei(this.parent.settings, totalUBA, prices.amgToNatWei);
            return this.totalPoolCollateralNATWei.muln(MAX_BIPS).div(backingCollateral);
        }
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
        this.freeUnderlyingBalanceUBA = this.freeUnderlyingBalanceUBA.add(toBN(args.agentFeeUBA));
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
        Object.defineProperty(this.agentSettings, 'mintingClass1CollateralRatioBIPS', toBN(args.mintingClass1CollateralRatioBIPS));
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
    depositClass1Collateral(token: string, value: BN): void {
        this.totalClass1CollateralWei[token] = this.totalClass1CollateralWei[token] ? this.totalClass1CollateralWei[token].add(value) : value;
    }

    withdrawClass1Collateral(token: string, value: BN): void {
        this.totalClass1CollateralWei[token] = this.totalClass1CollateralWei[token] ? this.totalClass1CollateralWei[token].sub(value) : value;
    }

    // agent state changing
    depositPoolCollateral(value: BN): void {
        this.totalPoolCollateralNATWei = this.totalPoolCollateralNATWei.add(value);
    }

    withdrawPoolCollateral(value: BN): void {
        this.totalPoolCollateralNATWei = this.totalPoolCollateralNATWei.sub(value);
    }

    handleAgentSettingChanged(name: string, value: string): void {
        Object.defineProperty(this.agentSettings, name, name === 'class1CollateralToken' ? value : toBN(value));
    }

}