import { AgentInfo } from "@flarelabs/fasset-bots-core";
import type { BNish } from "@flarelabs/fasset-bots-core/utils";

export interface AgentCreateResponse {
    vaultAddress: string;
    ownerAddress: string;
    collateralPoolAddress: string;
    collateralPoolTokenAddress: string;
    underlyingAddress: string;
}

export interface AgentBalance {
    balance: string;
}

export interface AgentUnderlying {
    paymentReference?: string | null;
    transactionHash?: string | null;
    address?: string;
    privateKey?: string;
    transactionDatabaseId?: number | null;
}

export interface AgentSettings {
    vaultCollateralToken: string;
    vaultCollateralSymbol: string;
    feeBIPS: string;
    poolFeeShareBIPS: string;
    mintingVaultCollateralRatioBIPS: string;
    mintingPoolCollateralRatioBIPS: string;
    poolExitCollateralRatioBIPS: string;
    buyFAssetByAgentFactorBIPS: string;
    poolTopupCollateralRatioBIPS: string;
    poolTopupTokenPriceFactorBIPS: string;
    handshakeType: string;
}

export interface AgentData {
    collaterals: {
        symbol: string;
        balance: string;
        wrapped?: string;
    }[]
    whitelisted: boolean;
}

export interface WorkAddress {
    address: string;
    private_key: string;
}

export interface AllCollaterals {
    fassetSymbol: string,
    collaterals: {
        symbol: string;
        balance: string;
        wrapped?: string;
    }[]
}

export interface AllBalances {
    symbol: string;
    balance: string;
    wrapped?: string;
}

export interface RequestableVaultCVData {
    requestableLotsVault: number;
    requestableLotsCV: number;
    lotSize: number;
}

export interface RedeemableVaultCVData {
    redeemableLotsOwner: number;
    requestableLotsCV: number;
    minimumLotsToRedeem: number;
    lotSize: number;
}

export interface AMGSettings {
    assetMintingDecimals: BNish;
    assetMintingGranularityUBA: BNish;
}

export interface DepositableVaultCVData {
    underlyingBalance: string;
    transferableBalance: string;
}

export interface UnderlyingAddress {
    asset: string;
    address: string;
}

export interface Collaterals {
    symbol: string;
    amount: string;
    ownerBalance: string;
}

export interface Delegation {
    address: string;
    delegation: string;
}


export interface VaultInfo {
    address: string;
    updating: boolean;
    status: boolean;
    mintedlots: string;
    freeLots: string;
    vaultCR: string;
    poolCR: string;
    mintedAmount: string;
    vaultAmount: string;
    poolAmount: string;
    agentCPTs: string;
    collateralToken: string;
    health: string;
    poolCollateralUSD: string;
    mintCount: string;
    poolFee: string;
    createdAt: number;
    fasset: string;
    lotsPoolBacked: string;
    lotsVaultBacked: string;
    handshakeType: number;
    delegates: Delegation[];
    delegationPercentage: string;
    allLots: string;
    underlyingSymbol: string;
    redeemCapacity: string;
}

export interface AllVaults {
    fassetSymbol: string,
    vaults: VaultInfo[]
}

export interface CollateralTemplate {
    symbol: string;
    template: string;
}
export interface VaultCollaterals {
    fassetSymbol: string;
    collaterals: CollateralTemplate[];
}

export interface AgentVaultStatus {
    vaultAddress: string;
    poolCollateralRatioBIPS: string;
    vaultCollateralRatioBIPS: string;
    agentSettingUpdateValidAtFeeBIPS: string;
    agentSettingUpdateValidAtPoolFeeShareBIPS: string;
    agentSettingUpdateValidAtMintingVaultCrBIPS: string;
    agentSettingUpdateValidAtMintingPoolCrBIPS: string;
    agentSettingUpdateValidAtBuyFAssetByAgentFactorBIPS: string;
    agentSettingUpdateValidAtPoolExitCrBIPS: string;
    agentSettingUpdateValidAtPoolTopupCrBIPS: string;
    agentSettingUpdateValidAtPoolTopupTokenPriceFactorBIPS: string;
    agentSettingUpdateValidAtHandshakeType: string;
}

type BNsToStrings<T> = {
    [P in keyof T]: T[P] extends BNish ? string : T[P] extends boolean ? boolean : T[P]
}
export type AgentVaultInfo = BNsToStrings<AgentInfo>

export type ExtendedAgentVaultInfo = AgentVaultInfo & {
    poolSuffix: string;
    delegates: Delegation[];
    redemptionPoolFeeShareBIPS: string;
};

export const requiredKeysForSecrets = ["wallet.encryption_password",
                                        "apiKey.indexer", "apiKey.xrp_rpc", "apiKey.native_rpc", "apiKey.agent_bot",
                                    "owner.management.address", "owner.native.address", "owner.native.private_key",
                                    "owner.testXRP.address", "owner.testXRP.private_key"];

export interface APIKey {
    key: string;
    hash: string;
}

export interface TransferToCVFee {
    fee: string;
    feeUSD: string;
    symbol: string;
}

export interface RedemptionQueueData {
    mintedLots: number;
    redemptionQueueLots: number;
}