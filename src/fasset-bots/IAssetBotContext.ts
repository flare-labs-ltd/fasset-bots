import { IFtsoManagerInstance, FAssetInstance, AssetManagerInstance, WNatInstance, IERC20Instance, AddressUpdaterInstance } from "../../typechain-truffle";
import { CollateralType } from "../fasset/AssetManagerTypes";
import { ChainInfo, NativeChainInfo } from "../fasset/ChainInfo";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { BlockchainIndexerHelper } from "../underlying-chain/BlockchainIndexerHelper";
import { IBlockChainWallet } from "../underlying-chain/interfaces/IBlockChainWallet";
import { ContractWithEvents } from "../utils/events/truffle";

export type AddressUpdaterEvents = import("../../typechain-truffle/AddressUpdater").AllEvents;
export type WNatEvents = import("../../typechain-truffle/WNat").AllEvents;
export type IFtsoManagerEvents = import("../../typechain-truffle/IFtsoManager").AllEvents;
export type AssetManagerEvents = import("../../typechain-truffle/AssetManager").AllEvents;
export type FAssetEvents = import("../../typechain-truffle/FAsset").AllEvents;
export type IERC20Events = import("../../typechain-truffle/IERC20").AllEvents;

export interface IAssetAgentBotContext {
    nativeChainInfo: NativeChainInfo;
    chainInfo: ChainInfo;
    blockchainIndexer: BlockchainIndexerHelper;
    wallet: IBlockChainWallet;
    attestationProvider: AttestationHelper;
    // contracts
    ftsoManager: ContractWithEvents<IFtsoManagerInstance, IFtsoManagerEvents>;
    wNat: ContractWithEvents<WNatInstance, WNatEvents>;
    fAsset: ContractWithEvents<FAssetInstance, FAssetEvents>;
    assetManager: ContractWithEvents<AssetManagerInstance, AssetManagerEvents>;
    stablecoins: Record<string, ContractWithEvents<IERC20Instance, IERC20Events>>;
    collaterals: CollateralType[];
    addressUpdater: ContractWithEvents<AddressUpdaterInstance, AddressUpdaterEvents>;
}




export interface AgentBotDefaultSettings {
    vaultCollateralToken: string;
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
