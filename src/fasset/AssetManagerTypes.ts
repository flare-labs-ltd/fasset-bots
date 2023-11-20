import { AssetManagerContract, AssetManagerInstance } from "../../typechain-truffle";

type _AssetManagerSettings = Parameters<AssetManagerContract["new"]>[0];
export type AssetManagerSettings = _AssetManagerSettings;

export enum CollateralClass {
    POOL = 1,
    VAULT = 2,
}

type _CollateralType = Parameters<AssetManagerContract["new"]>[1][0];
export type CollateralType = _CollateralType;

type _AgentSettings = Parameters<AssetManagerInstance["createAgentVault"]>[0];
export type AgentSettings = _AgentSettings;

// status as returned from GetAgentInfo
export enum AgentStatus {
    NORMAL = 0, // agent is operating normally
    CCB = 1, // agent in collateral call band
    LIQUIDATION = 2, // liquidation due to collateral ratio - ends when agent is healthy
    FULL_LIQUIDATION = 3, // illegal payment liquidation - always liquidates all and then agent must close vault
    DESTROYING = 4, // agent announced destroy, cannot mint again; all existing mintings have been redeemed before
}

type _AgentInfo = Awaited<ReturnType<AssetManagerInstance["getAgentInfo"]>>;
export type AgentInfo = _AgentInfo;

type _AvailableAgentInfo = Awaited<ReturnType<AssetManagerInstance["getAvailableAgentsDetailedList"]>>[0][0];
export type AvailableAgentInfo = _AvailableAgentInfo;

export type AgentSetting =
    | "feeBIPS"
    | "poolFeeShareBIPS"
    | "mintingVaultCollateralRatioBIPS"
    | "mintingPoolCollateralRatioBIPS"
    | "buyFAssetByAgentFactorBIPS"
    | "poolExitCollateralRatioBIPS"
    | "poolTopupCollateralRatioBIPS"
    | "poolTopupTokenPriceFactorBIPS";

export enum TokenExitType { MAXIMIZE_FEE_WITHDRAWAL, MINIMIZE_FEE_DEBT, KEEP_RATIO };
