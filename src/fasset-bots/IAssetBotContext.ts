import { CollateralToken } from "../fasset/AssetManagerTypes";
import { IAssetContext } from "../fasset/IAssetContext";
import { BlockChainIndexerHelper } from "../underlying-chain/BlockChainIndexerHelper";

export interface IAssetBotContext extends IAssetContext {
    blockChainIndexerClient: BlockChainIndexerHelper,
    collaterals: CollateralToken[]
}

export interface AgentBotSettings {
    class1CollateralToken: string,
    feeBIPS: BN,
    poolFeeShareBIPS: BN,
    mintingClass1CollateralRatioBIPS: BN,
    mintingPoolCollateralRatioBIPS: BN,
    poolExitCollateralRatioBIPS: BN,
    buyFAssetByAgentFactorBIPS: BN,
    poolTopupCollateralRatioBIPS: BN,
    poolTopupTokenPriceFactorBIPS: BN
}