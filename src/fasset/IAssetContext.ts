import { AssetManagerControllerInstance, AssetManagerInstance, FAssetInstance, FtsoManagerMockInstance, FtsoMockInstance, FtsoRegistryMockInstance, WNatInstance } from "fasset/typechain-truffle";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { IBlockChain } from "../underlying-chain/interfaces/IBlockChain";
import { UnderlyingChainEvents } from "../underlying-chain/UnderlyingChainEvents";
import { ContractWithEvents } from "../utils/events/truffle";
import { ChainInfo } from "./ChainInfo";

export type AddressUpdaterEvents = import('fasset/typechain-truffle/AddressUpdater').AllEvents;
export type AssetManagerControllerEvents = import('fasset/typechain-truffle/AssetManagerController').AllEvents;
export type WNatEvents = import('fasset/typechain-truffle/WNat').AllEvents;
export type StateConnectorMockEvents = import('fasset/typechain-truffle/StateConnectorMock').AllEvents;
export type AgentVaultFactoryEvents = import('fasset/typechain-truffle/AgentVaultFactory').AllEvents;
export type AttestationClientSCEvents = import('fasset/typechain-truffle/AttestationClientSC').AllEvents;
export type FtsoRegistryMockEvents = import('fasset/typechain-truffle/FtsoRegistryMock').AllEvents;
export type FtsoMockEvents = import('fasset/typechain-truffle/FtsoMock').AllEvents;
export type FtsoManagerMockEvents = import('fasset/typechain-truffle/FtsoManagerMock').AllEvents;
export type AssetManagerEvents = import('fasset/typechain-truffle/AssetManager').AllEvents;
export type FAssetEvents = import('fasset/typechain-truffle/FAsset').AllEvents;

export interface IAssetContext {
    chainInfo: ChainInfo;
    chain: IBlockChain;
    chainEvents: UnderlyingChainEvents;
    attestationProvider: AttestationHelper;
    // contracts
    assetManagerController: ContractWithEvents<AssetManagerControllerInstance, AssetManagerControllerEvents>;
    ftsoRegistry: ContractWithEvents<FtsoRegistryMockInstance, FtsoRegistryMockEvents>;
    ftsoManager: ContractWithEvents<FtsoManagerMockInstance, FtsoManagerMockEvents>;
    wnat: ContractWithEvents<WNatInstance, WNatEvents>;
    natFtso: ContractWithEvents<FtsoMockInstance, FtsoMockEvents>;
    fAsset: ContractWithEvents<FAssetInstance, FAssetEvents>;
    assetFtso: ContractWithEvents<FtsoMockInstance, FtsoMockEvents>;
    assetManager: ContractWithEvents<AssetManagerInstance, AssetManagerEvents>;
}
