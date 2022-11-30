import { IAssetContext } from "../fasset/IAssetContext";
import { BlockChainIndexerHelper } from "../underlying-chain/BlockChainIndexerHelper";

export interface IAssetBotContext extends IAssetContext {
    blockChainIndexerClient: BlockChainIndexerHelper;
}