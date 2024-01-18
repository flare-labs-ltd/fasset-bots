import BN from "bn.js";
import { AddressUpdaterInstance, AssetManagerInstance, FAssetInstance, IPriceChangeEmitterInstance, WNatInstance } from "../../typechain-truffle";
import { ChainInfo, NativeChainInfo } from "../fasset/ChainInfo";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { BlockchainIndexerHelper } from "../underlying-chain/BlockchainIndexerHelper";
import { IBlockChainWallet } from "../underlying-chain/interfaces/IBlockChainWallet";
import { ContractWithEvents } from "../utils/events/truffle";
import { IVerificationApiClient } from "../underlying-chain/interfaces/IVerificationApiClient";

export type AddressUpdaterEvents = import("../../typechain-truffle/AddressUpdater").AllEvents;
export type WNatEvents = import("../../typechain-truffle/WNat").AllEvents;
export type AssetManagerEvents = import("../../typechain-truffle/AssetManager").AllEvents;
export type FAssetEvents = import("../../typechain-truffle/FAsset").AllEvents;
export type IERC20Events = import("../../typechain-truffle/IERC20").AllEvents;
export type IPriceChangeEmitterEvents = import("../../typechain-truffle/IPriceChangeEmitter").AllEvents;

export interface IAssetNativeChainContext {
    nativeChainInfo: NativeChainInfo;
    priceChangeEmitter: ContractWithEvents<IPriceChangeEmitterInstance, IPriceChangeEmitterEvents>;
    wNat: ContractWithEvents<WNatInstance, WNatEvents>;
    fAsset: ContractWithEvents<FAssetInstance, FAssetEvents>;
    assetManager: ContractWithEvents<AssetManagerInstance, AssetManagerEvents>;
    addressUpdater: ContractWithEvents<AddressUpdaterInstance, AddressUpdaterEvents>;
}

export interface IAssetAgentBotContext extends IAssetNativeChainContext {
    chainInfo: ChainInfo;
    blockchainIndexer: BlockchainIndexerHelper;
    wallet: IBlockChainWallet;
    attestationProvider: AttestationHelper;
    verificationClient: IVerificationApiClient;
}

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
export interface IAssetActorContext extends IAssetNativeChainContext {
    blockchainIndexer?: BlockchainIndexerHelper; // only for challenger
    attestationProvider?: AttestationHelper; // only for challenger
    // liquidation / challenger strategies
    liquidationStrategy?: {
        // only for liquidator
        className: string;
        config?: any;
    };
    challengeStrategy?: {
        // only for challenger
        className: string;
        config?: any;
    };
}
