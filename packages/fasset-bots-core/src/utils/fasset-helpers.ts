import { IIAssetManagerInstance } from "../../typechain-truffle";
import { AssetManagerEvents, IAssetAgentContext } from "../fasset-bots/IAssetBotContext";
import { AgentInfo, AgentSettings } from "../fasset/AssetManagerTypes";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { BlockchainIndexerHelper } from "../underlying-chain/BlockchainIndexerHelper";
import { IBlock } from "../underlying-chain/interfaces/IBlockChain";
import { ContractWithEvents } from "./events/truffle";
import { BNish, TRANSACTION_FEE_FACTOR, requireNotNull, toBN, toNumber } from "./helpers";
import { logger } from "./logger";
import { TokenBalances } from "./token-balances";
import { web3DeepNormalize } from "./web3normalize";

export function getAgentSettings(agentInfo: AgentInfo): AgentSettings {
    const agentSettings = {} as AgentSettings;
    agentSettings.vaultCollateralToken = agentInfo.vaultCollateralToken;
    agentSettings.feeBIPS = toBN(agentInfo.feeBIPS);
    agentSettings.poolFeeShareBIPS = toBN(agentInfo.poolFeeShareBIPS);
    agentSettings.mintingVaultCollateralRatioBIPS = toBN(agentInfo.mintingVaultCollateralRatioBIPS);
    agentSettings.mintingPoolCollateralRatioBIPS = toBN(agentInfo.mintingPoolCollateralRatioBIPS);
    agentSettings.poolExitCollateralRatioBIPS = toBN(agentInfo.poolExitCollateralRatioBIPS);
    agentSettings.buyFAssetByAgentFactorBIPS = toBN(agentInfo.buyFAssetByAgentFactorBIPS);
    agentSettings.poolTopupCollateralRatioBIPS = toBN(agentInfo.poolTopupCollateralRatioBIPS);
    agentSettings.poolTopupTokenPriceFactorBIPS = toBN(agentInfo.poolTopupTokenPriceFactorBIPS);
    return agentSettings;
}

/**
 * Prove that a block with given number and timestamp exists and
 * update the current underlying block info if the provided data higher.
 * This method should be called by minters before minting and by agent's regularly
 * to prevent current block being too outdated, which gives too short time for
 * minting or redemption payment.
 */
export async function proveAndUpdateUnderlyingBlock(
    attestationProvider: AttestationHelper,
    assetManager: ContractWithEvents<IIAssetManagerInstance, AssetManagerEvents>,
    caller: string,
    queryWindow: number = 7200 // don't need 1 day long query to prove last block
): Promise<number> {
    const proof = await attestationProvider.proveConfirmedBlockHeightExists(queryWindow);
    await assetManager.updateCurrentBlock(web3DeepNormalize(proof), { from: caller });
    return toNumber(proof.data.requestBody.blockNumber) + toNumber(proof.data.responseBody.numberOfConfirmations);
}

export async function attestationWindowSeconds(assetManager: IIAssetManagerInstance): Promise<number> {
    const settings = await assetManager.getSettings();
    return Number(settings.attestationWindowSeconds);
}

export async function latestUnderlyingBlock(blockchainIndexer: BlockchainIndexerHelper): Promise<IBlock> {
    const blockHeight = await blockchainIndexer.getBlockHeight();
    const latestBlock = await blockchainIndexer.getBlockAt(blockHeight);
    return requireNotNull(latestBlock, "Block at block height does not exist");
}

export async function checkUnderlyingFunds(context: IAssetAgentContext, sourceUnderlyingAddress: string, destinationUnderlyingAddress: string, amount: BNish): Promise<boolean> {
    const balanceReader = await TokenBalances.fassetUnderlyingToken(context);
    const senderBalance = await balanceReader.balance(sourceUnderlyingAddress);
    const transactionFee = await context.wallet.getTransactionFee();
    const requiredBalance = toBN(amount).add(context.chainInfo.minimumAccountBalance).add(transactionFee.muln(TRANSACTION_FEE_FACTOR));
    if (senderBalance.gte(requiredBalance)) {
        return true;
    }  else {
        logger.error(`Cannot performing underlying payment from ${sourceUnderlyingAddress} to ${destinationUnderlyingAddress}.
        Available ${balanceReader.format(senderBalance)}. Required ${balanceReader.format(requiredBalance)}`);
        return false;
    }
}