import BN from "bn.js";
import { AgentStatus } from "../actors/AgentBot";
import { AgentInfo, AssetManagerSettings } from "../fasset/AssetManagerTypes";
import { MAX_BIPS, MAX_UINT256, toBN } from "../utils/helpers";
import { Prices } from "./Prices";
import { convertUBAToNATWei } from "../fasset/Conversions";

export class TrackedAgent {
    constructor(
        public vaultAddress: string,
        public ownerAddress: string,
        public underlyingAddress: string
    ) { }

    status = AgentStatus.NORMAL;
    ccbStartTimestamp = toBN(0);
    liquidationStartTimestamp = toBN(0);

    async possibleLiquidationTransition(timestamp: BN, settings: AssetManagerSettings, agentInfo: AgentInfo, prices: Prices, trustedPrices: Prices): Promise<Number> {
        const cr = await this.collateralRatioBIPS(settings, agentInfo, prices, trustedPrices);
        const agentStatus = Number(agentInfo.status);
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

    async collateralRatioBIPS(settings: AssetManagerSettings, agentInfo: AgentInfo, prices: Prices, trustedPrices: Prices): Promise<BN> {
        const ratio = this.collateralRatioForPriceBIPS(prices, agentInfo, settings);
        const ratioFromTrusted = this.collateralRatioForPriceBIPS(trustedPrices, agentInfo, settings);
        return BN.max(ratio, ratioFromTrusted);
    }

    private collateralRatioForPriceBIPS(prices: Prices, agentInfo: AgentInfo, settings: AssetManagerSettings): BN {
        const totalUBA = toBN(agentInfo.reservedUBA).add(toBN(agentInfo.mintedUBA)).add(toBN(agentInfo.redeemingUBA));
        if (totalUBA.isZero()) return MAX_UINT256;
        const backingCollateral = convertUBAToNATWei(settings, totalUBA, prices.amgNatWei);
        return toBN(agentInfo.totalCollateralNATWei).muln(MAX_BIPS).div(backingCollateral);
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

}

