import { AssetManagerInitInstance, IIAssetManagerInstance } from "../../typechain-truffle";

export enum CollateralClass {
    POOL = 1,
    VAULT = 2,
}

// status as returned from GetAgentInfo
export enum AgentStatus {
    NORMAL = 0, // agent is operating normally
    CCB = 1, // agent in collateral call band
    LIQUIDATION = 2, // liquidation due to collateral ratio - ends when agent is healthy
    FULL_LIQUIDATION = 3, // illegal payment liquidation - always liquidates all and then agent must close vault
    DESTROYING = 4, // agent announced destroy, cannot mint again; all existing mintings have been redeemed before
}

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

type _AssetManagerSettings = Parameters<AssetManagerInitInstance['init']>[2];
export interface AssetManagerSettings extends _AssetManagerSettings {}

type _CollateralType = Parameters<AssetManagerInitInstance['init']>[3][0];
export interface CollateralType extends _CollateralType {}

type _AgentSettings = Parameters<IIAssetManagerInstance["createAgentVault"]>[1];
export interface AgentSettings extends _AgentSettings {}

type _AgentInfo = Awaited<ReturnType<IIAssetManagerInstance["getAgentInfo"]>>;
export interface AgentInfo extends _AgentInfo {}

type _AvailableAgentInfo = Awaited<ReturnType<IIAssetManagerInstance["getAvailableAgentsDetailedList"]>>[0][0];
export interface AvailableAgentInfo extends _AvailableAgentInfo {}
