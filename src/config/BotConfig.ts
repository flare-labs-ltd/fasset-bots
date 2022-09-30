import { ChainInfo } from "../fasset/ChainInfo";
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
}

export interface BotConfig {
    rpcUrl: string;
    // either one most be set
    addressUpdater?: string;
    constractsJsonFile?: string;
    stateConnector: IStateConnectorClient;
    chains: BotConfigChain[];
}
