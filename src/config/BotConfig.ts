import { ChainInfo, NativeChainInfo } from "../fasset/ChainInfo";
import { BlockChainIndexerHelper } from "../underlying-chain/BlockChainIndexerHelper";
import { IBlockChain } from "../underlying-chain/interfaces/IBlockChain";
import { IBlockChainEvents } from "../underlying-chain/interfaces/IBlockChainEvents";
import { IBlockChainWallet } from "../underlying-chain/interfaces/IBlockChainWallet";
import { IStateConnectorClient } from "../underlying-chain/interfaces/IStateConnectorClient";

export interface BotConfigChain {
    chainInfo: ChainInfo;
    chain: IBlockChain;
    chainEvents: IBlockChainEvents,
    wallet: IBlockChainWallet;
    assetManager?: string;
    fAssetSymbol?: string;
    blockChainIndexerClient: BlockChainIndexerHelper;
}

export interface BotConfig {
    rpcUrl: string;
    loopDelay: number;
    // either one most be set
    addressUpdater?: string;
    contractsJsonFile?: string;
    stateConnector: IStateConnectorClient;
    chains: BotConfigChain[];
    nativeChainInfo: NativeChainInfo;
}
