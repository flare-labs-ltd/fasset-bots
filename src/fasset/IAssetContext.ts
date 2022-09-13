import { AssetManagerControllerInstance, AssetManagerInstance, FAssetInstance, IFtsoManagerInstance, IFtsoRegistryInstance, IIFtsoInstance, WNatInstance } from "../../typechain-truffle";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { IBlockChain } from "../underlying-chain/interfaces/IBlockChain";
import { IBlockChainWallet } from "../underlying-chain/interfaces/IBlockChainWallet";
import { UnderlyingChainEvents } from "../underlying-chain/UnderlyingChainEvents";
import { ContractWithEvents } from "../utils/events/truffle";
import { ChainInfo } from "./ChainInfo";

export type AddressUpdaterEvents = import('../../typechain-truffle/AddressUpdater').AllEvents;
export type AssetManagerControllerEvents = import('../../typechain-truffle/AssetManagerController').AllEvents;
export type WNatEvents = import('../../typechain-truffle/WNat').AllEvents;
export type IStateConnectorEvents = import('../../typechain-truffle/IStateConnector').AllEvents;
export type AgentVaultFactoryEvents = import('../../typechain-truffle/AgentVaultFactory').AllEvents;
export type AttestationClientSCEvents = import('../../typechain-truffle/AttestationClientSC').AllEvents;
export type IFtsoRegistryEvents = import('../../typechain-truffle/IFtsoRegistry').AllEvents;
export type IIFtsoEvents = import('../../typechain-truffle/IIFtso').AllEvents;
export type IFtsoManagerEvents = import('../../typechain-truffle/IFtsoManager').AllEvents;
export type AssetManagerEvents = import('../../typechain-truffle/AssetManager').AllEvents;
export type FAssetEvents = import('../../typechain-truffle/FAsset').AllEvents;

export interface IAssetContext {
    chainInfo: ChainInfo;
    chain: IBlockChain;
    wallet: IBlockChainWallet;
    chainEvents: UnderlyingChainEvents;
    attestationProvider: AttestationHelper;
    // contracts
    assetManagerController: ContractWithEvents<AssetManagerControllerInstance, AssetManagerControllerEvents>;
    ftsoRegistry: ContractWithEvents<IFtsoRegistryInstance, IFtsoRegistryEvents>;
    ftsoManager: ContractWithEvents<IFtsoManagerInstance, IFtsoManagerEvents>;
    wnat: ContractWithEvents<WNatInstance, WNatEvents>;
    natFtso: ContractWithEvents<IIFtsoInstance, IIFtsoEvents>;
    fAsset: ContractWithEvents<FAssetInstance, FAssetEvents>;
    assetFtso: ContractWithEvents<IIFtsoInstance, IIFtsoEvents>;
    assetManager: ContractWithEvents<AssetManagerInstance, AssetManagerEvents>;
    // others
    
}
