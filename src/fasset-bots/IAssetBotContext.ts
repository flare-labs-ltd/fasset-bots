import { IFtsoManagerInstance, FAssetInstance, IIFtsoInstance, AssetManagerInstance, IFtsoRegistryInstance } from "../../typechain-truffle";
import { CollateralType } from "../fasset/AssetManagerTypes";
import { NativeChainInfo } from "../fasset/ChainInfo";
import { AssetManagerEvents, FAssetEvents, IAssetContext, IFtsoManagerEvents, IFtsoRegistryEvents, IIFtsoEvents } from "../fasset/IAssetContext";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { BlockchainIndexerHelper } from "../underlying-chain/BlockchainIndexerHelper";
import { ContractWithEvents } from "../utils/events/truffle";

export interface IAssetAgentBotContext extends IAssetContext {
    collaterals: CollateralType[];
}

export interface AgentBotDefaultSettings {
    class1CollateralToken: string;
    feeBIPS: BN;
    poolFeeShareBIPS: BN;
    mintingClass1CollateralRatioBIPS: BN;
    mintingPoolCollateralRatioBIPS: BN;
    poolExitCollateralRatioBIPS: BN;
    buyFAssetByAgentFactorBIPS: BN;
    poolTopupCollateralRatioBIPS: BN;
    poolTopupTokenPriceFactorBIPS: BN;
}

// lightweight context
export interface IAssetTrackedStateContext {
    blockchainIndexer: BlockchainIndexerHelper;
    collaterals: CollateralType[];
    nativeChainInfo: NativeChainInfo;
    attestationProvider: AttestationHelper;
    // contracts
    ftsoRegistry: ContractWithEvents<IFtsoRegistryInstance, IFtsoRegistryEvents>;
    ftsoManager: ContractWithEvents<IFtsoManagerInstance, IFtsoManagerEvents>;
    fAsset: ContractWithEvents<FAssetInstance, FAssetEvents>;
    assetFtso: ContractWithEvents<IIFtsoInstance, IIFtsoEvents>;
    assetManager: ContractWithEvents<AssetManagerInstance, AssetManagerEvents>;
}