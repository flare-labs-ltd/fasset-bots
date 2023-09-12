import { IFtsoManagerInstance, FAssetInstance, AssetManagerInstance } from "../../typechain-truffle";
import { CollateralType } from "../fasset/AssetManagerTypes";
import { NativeChainInfo } from "../fasset/ChainInfo";
import { AssetManagerEvents, FAssetEvents, IAssetContext, IFtsoManagerEvents } from "../fasset/IAssetContext";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { BlockchainIndexerHelper } from "../underlying-chain/BlockchainIndexerHelper";
import { ContractWithEvents } from "../utils/events/truffle";

export type IAssetAgentBotContext = IAssetContext;

export interface AgentBotDefaultSettings {
    vaultCollateralToken: string;
    poolTokenSuffix: string;
    feeBIPS: BN;
    poolFeeShareBIPS: BN;
    mintingVaultCollateralRatioBIPS: BN;
    mintingPoolCollateralRatioBIPS: BN;
    poolExitCollateralRatioBIPS: BN;
    buyFAssetByAgentFactorBIPS: BN;
    poolTopupCollateralRatioBIPS: BN;
    poolTopupTokenPriceFactorBIPS: BN;
}

// lightweight context
export interface IAssetActorContext {
    nativeChainInfo: NativeChainInfo;
    blockchainIndexer: BlockchainIndexerHelper;
    collaterals: CollateralType[];
    attestationProvider: AttestationHelper;
    // contracts
    ftsoManager: ContractWithEvents<IFtsoManagerInstance, IFtsoManagerEvents>;
    fAsset: ContractWithEvents<FAssetInstance, FAssetEvents>;
    assetManager: ContractWithEvents<AssetManagerInstance, AssetManagerEvents>;
}
