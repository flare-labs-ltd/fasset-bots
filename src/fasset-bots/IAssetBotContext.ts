import { IFtsoManagerInstance, FAssetInstance, IIFtsoInstance, AssetManagerInstance, IFtsoRegistryInstance } from "../../typechain-truffle";
import { CollateralType } from "../fasset/AssetManagerTypes";
import { NativeChainInfo } from "../fasset/ChainInfo";
import { AssetManagerEvents, FAssetEvents, IAssetContext, IFtsoManagerEvents, IFtsoRegistryEvents, IIFtsoEvents } from "../fasset/IAssetContext";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { BlockChainIndexerHelper } from "../underlying-chain/BlockChainIndexerHelper";
import { IBlockChain } from "../underlying-chain/interfaces/IBlockChain";
import { ContractWithEvents } from "../utils/events/truffle";

export interface IAssetAgentBotContext extends IAssetContext {
    blockChainIndexerClient: BlockChainIndexerHelper;
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

export interface IAssetTrackedStateContext {
    blockChainIndexerClient: BlockChainIndexerHelper;
    collaterals: CollateralType[];
    nativeChainInfo: NativeChainInfo;
    chain: IBlockChain;
    attestationProvider: AttestationHelper;
    // contracts
    ftsoRegistry: ContractWithEvents<IFtsoRegistryInstance, IFtsoRegistryEvents>;
    ftsoManager: ContractWithEvents<IFtsoManagerInstance, IFtsoManagerEvents>;
    fAsset: ContractWithEvents<FAssetInstance, FAssetEvents>;
    assetFtso: ContractWithEvents<IIFtsoInstance, IIFtsoEvents>;
    assetManager: ContractWithEvents<AssetManagerInstance, AssetManagerEvents>;
}