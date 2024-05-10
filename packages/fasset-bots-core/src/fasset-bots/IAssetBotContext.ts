import { AddressUpdaterInstance, AgentOwnerRegistryInstance, AssetManagerControllerInstance, FAssetInstance, IIAssetManagerInstance, IPriceChangeEmitterInstance, WNatInstance } from "../../typechain-truffle";
import { ChainInfo } from "../fasset/ChainInfo";
import { NativeChainInfo } from "../fasset/ChainInfo";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { BlockchainIndexerHelper } from "../underlying-chain/BlockchainIndexerHelper";
import { IBlockChainWallet } from "../underlying-chain/interfaces/IBlockChainWallet";
import { IVerificationApiClient } from "../underlying-chain/interfaces/IVerificationApiClient";
import { ContractWithEvents } from "../utils/events/truffle";

export type AddressUpdaterEvents = import("../../typechain-truffle/AddressUpdater").AllEvents;
export type WNatEvents = import("../../typechain-truffle/WNat").AllEvents;
export type AssetManagerControllerEvents = import("../../typechain-truffle/AssetManagerController").AllEvents;
export type AssetManagerEvents = import("../../typechain-truffle/IIAssetManager").AllEvents;
export type FAssetEvents = import("../../typechain-truffle/FAsset").AllEvents;
export type IERC20Events = import("../../typechain-truffle/IERC20").AllEvents;
export type IPriceChangeEmitterEvents = import("../../typechain-truffle/IPriceChangeEmitter").AllEvents;
export type AgentOwnerRegistryEvents = import("../../typechain-truffle/AgentOwnerRegistry").AllEvents;

export interface IAssetNativeChainContext {
    nativeChainInfo: NativeChainInfo;
    priceChangeEmitter: ContractWithEvents<IPriceChangeEmitterInstance, IPriceChangeEmitterEvents>;
    wNat: ContractWithEvents<WNatInstance, WNatEvents>;
    fAsset: ContractWithEvents<FAssetInstance, FAssetEvents>;
    assetManager: ContractWithEvents<IIAssetManagerInstance, AssetManagerEvents>;
    assetManagerController: ContractWithEvents<AssetManagerControllerInstance, AssetManagerControllerEvents>;
    addressUpdater: ContractWithEvents<AddressUpdaterInstance, AddressUpdaterEvents>;
    agentOwnerRegistry: ContractWithEvents<AgentOwnerRegistryInstance, AgentOwnerRegistryEvents>;
}

export interface IAssetAgentContext extends IAssetNativeChainContext {
    chainInfo: ChainInfo;
    blockchainIndexer: BlockchainIndexerHelper;
    wallet: IBlockChainWallet;
    attestationProvider: AttestationHelper;
    verificationClient: IVerificationApiClient;
}

export interface ITimekeeperContext extends IAssetNativeChainContext {
    blockchainIndexer: BlockchainIndexerHelper;
    attestationProvider: AttestationHelper;
}

export interface ILiquidatorContext extends IAssetNativeChainContext {
    liquidationStrategy?: {
        className: string;
        config?: any;
    };
}

export interface IChallengerContext extends IAssetNativeChainContext {
    blockchainIndexer: BlockchainIndexerHelper;
    attestationProvider: AttestationHelper;
    challengeStrategy?: {
        className: string;
        config?: any;
    };
}
