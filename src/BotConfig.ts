import { ChainInfo } from "./fasset/ChainInfo";
import { IBlockChain } from "./underlying-chain/interfaces/IBlockChain";
import { IBlockChainEvents } from "./underlying-chain/interfaces/IBlockChainEvents";
import { IBlockChainWallet } from "./underlying-chain/interfaces/IBlockChainWallet";
import { IStateConnectorClient } from "./underlying-chain/interfaces/IStateConnectorClient";

export interface BotConfigChain {
    chainInfo: ChainInfo;
    chain: IBlockChain;
    chainEvents: IBlockChainEvents,
    wallet: IBlockChainWallet;
    assetManager: string;
}

export interface BotConfig {
    rpcUrl: string;
    addressUpdater: string;
    stateConnector: IStateConnectorClient;
    chains: BotConfigChain[];
}
