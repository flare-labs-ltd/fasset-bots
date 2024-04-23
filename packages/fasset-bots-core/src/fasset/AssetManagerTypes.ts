import { AssetManagerInitInstance, IIAssetManagerInstance } from "../../typechain-truffle";

type _AssetManagerSettings = Parameters<AssetManagerInitInstance['init']>[2];
export type AssetManagerSettings = _AssetManagerSettings;

export enum CollateralClass {
    POOL = 1,
    VAULT = 2,
}

export type CollateralType = Parameters<AssetManagerInitInstance['init']>[3][0];

export type AgentSettings = Parameters<IIAssetManagerInstance["createAgentVault"]>[1];

// status as returned from GetAgentInfo
export enum AgentStatus {
    NORMAL = 0, // agent is operating normally
    CCB = 1, // agent in collateral call band
    LIQUIDATION = 2, // liquidation due to collateral ratio - ends when agent is healthy
    FULL_LIQUIDATION = 3, // illegal payment liquidation - always liquidates all and then agent must close vault
    DESTROYING = 4, // agent announced destroy, cannot mint again; all existing mintings have been redeemed before
}

export type AgentInfo = Awaited<ReturnType<IIAssetManagerInstance["getAgentInfo"]>>;

export type AvailableAgentInfo = Awaited<ReturnType<IIAssetManagerInstance["getAvailableAgentsDetailedList"]>>[0][0];

export type AgentSetting =
    | "feeBIPS"
    | "poolFeeShareBIPS"
    | "mintingVaultCollateralRatioBIPS"
    | "mintingPoolCollateralRatioBIPS"
    | "buyFAssetByAgentFactorBIPS"
    | "poolExitCollateralRatioBIPS"
    | "poolTopupCollateralRatioBIPS"
    | "poolTopupTokenPriceFactorBIPS";

export enum TokenExitType {
    MAXIMIZE_FEE_WITHDRAWAL,
    MINIMIZE_FEE_DEBT,
    KEEP_RATIO,
}
