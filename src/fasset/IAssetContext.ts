import {
    AddressUpdaterInstance,
    AssetManagerInstance,
    FAssetInstance,
    IERC20Instance,
    IFtsoManagerInstance,
    WNatInstance,
} from "../../typechain-truffle";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { BlockchainIndexerHelper } from "../underlying-chain/BlockchainIndexerHelper";
import { IBlockChainWallet } from "../underlying-chain/interfaces/IBlockChainWallet";
import { ContractWithEvents } from "../utils/events/truffle";
import { CollateralType } from "./AssetManagerTypes";
import { ChainInfo, NativeChainInfo } from "./ChainInfo";

export type AddressUpdaterEvents = import("../../typechain-truffle/AddressUpdater").AllEvents;
export type WNatEvents = import("../../typechain-truffle/WNat").AllEvents;
export type IFtsoManagerEvents = import("../../typechain-truffle/IFtsoManager").AllEvents;
export type AssetManagerEvents = import("../../typechain-truffle/AssetManager").AllEvents;
export type FAssetEvents = import("../../typechain-truffle/FAsset").AllEvents;
export type IERC20Events = import("../../typechain-truffle/IERC20").AllEvents;

export interface IAssetContext {
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
