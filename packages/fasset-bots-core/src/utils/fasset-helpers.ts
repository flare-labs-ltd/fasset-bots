import BN from "bn.js";
import { IIAssetManagerInstance } from "../../typechain-truffle";
import { AssetManagerEvents, IAssetAgentContext, IAssetNativeChainContext } from "../fasset-bots/IAssetBotContext";
import { AgentInfo, AgentSettings } from "../fasset/AssetManagerTypes";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { BlockchainIndexerHelper } from "../underlying-chain/BlockchainIndexerHelper";
import { IBlock } from "../underlying-chain/interfaces/IBlockChain";
import { EvmEvent } from "./events/common";
import { ContractWithEvents, eventIs } from "./events/truffle";
import { BN_ZERO, BNish, TRANSACTION_FEE_FACTOR, requireNotNull, toBN, toNumber } from "./helpers";
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
/* istanbul ignore next */
export async function latestUnderlyingBlock(blockchainIndexer: BlockchainIndexerHelper): Promise<IBlock> {
    const blockHeight = await blockchainIndexer.getBlockHeight();
    const latestBlock = await blockchainIndexer.getBlockAt(blockHeight);
    return requireNotNull(latestBlock, "Block at block height does not exist");
}

export function requiredAddressBalance(amount: BNish, minimumBalance: BN, transactionFee: BN) {
    return toBN(amount).add(minimumBalance).add(transactionFee.muln(TRANSACTION_FEE_FACTOR));
}

export async function checkUnderlyingFunds(context: IAssetAgentContext, sourceAddress: string, amount: BNish, destinationAddress: string, feeSourceAddress?: string): Promise<void> {
    const balanceReader = await TokenBalances.fassetUnderlyingToken(context);
    const senderBalance = await balanceReader.balance(sourceAddress);
    const transactionFee = await context.wallet.getTransactionFee({source: sourceAddress, destination: destinationAddress, amount: toBN(amount), isPayment: true, feeSource: feeSourceAddress});
    const minAccountBalance = context.chainInfo.minimumAccountBalance;

    if (feeSourceAddress) {
        const requiredFeeBalance = requiredAddressBalance(transactionFee.muln(TRANSACTION_FEE_FACTOR), minAccountBalance, BN_ZERO)
        const senderFeeAddressBalance = await balanceReader.balance(feeSourceAddress);
        if (senderFeeAddressBalance.gt(requiredFeeBalance)) { // check fee source balance
            const requiredBalance = requiredAddressBalance(amount, minAccountBalance, BN_ZERO);
            if (!senderBalance.gte(requiredBalance)) { // check source balance
                const destinationInfo = destinationAddress ? ` to ${destinationAddress}.` : ".";
                logger.error(`Cannot perform underlying payment from ${sourceAddress}${destinationInfo}.
                Available ${balanceReader.format(senderBalance)}. Required ${balanceReader.format(requiredBalance)}.`);
                throw new Error(`Not enough funds on underlying address ${sourceAddress}. Available ${balanceReader.format(senderBalance)}. Required ${balanceReader.format(requiredBalance)}.`);
            } else { // both have enough balance
                return;
            }
        }
    }

    const requiredBalance = requiredAddressBalance(amount, minAccountBalance, transactionFee);
    if (!senderBalance.gte(requiredBalance)) {
        const destinationInfo = destinationAddress ? ` to ${destinationAddress}.` : ".";
        logger.error(`Cannot perform underlying payment from ${sourceAddress}${destinationInfo}.
        Available ${balanceReader.format(senderBalance)}. Required ${balanceReader.format(requiredBalance)}.`);
        throw new Error(`Not enough funds on underlying address ${sourceAddress}. Available ${balanceReader.format(senderBalance)}. Required ${balanceReader.format(requiredBalance)}.`);
    }
}

export async function checkEvmNativeFunds(context: IAssetAgentContext, sourceAddress: string, amount: BNish, destinationAddress?: string): Promise<void> {
    const balanceReader = await TokenBalances.evmNative(context);
    const senderBalance = await balanceReader.balance(sourceAddress);
    const requiredBalance = toBN(amount);
    if (!senderBalance.gte(requiredBalance)) {
        const destinationInfo = destinationAddress ? ` to ${destinationAddress}.` : ".";
        logger.error(`Cannot perform evm native payment from ${sourceAddress}${destinationInfo}
        Available ${balanceReader.format(senderBalance)}. Required ${balanceReader.format(requiredBalance)}.`);
        throw new Error(`Not enough funds on evm native address ${sourceAddress}`);
    }
}

export function isPriceChangeEvent(context: IAssetNativeChainContext, event: EvmEvent) {
    return eventIs(event, context.priceChangeEmitter, "PriceEpochFinalized") || eventIs(event, context.priceChangeEmitter, "PricesPublished");
}

export function isCollateralRatiosChangedEvent(context: IAssetNativeChainContext, event: EvmEvent) {
    return eventIs(event, context.assetManager, "CollateralRatiosChanged");
}

export function isContractChangedEvent(context: IAssetNativeChainContext, event: EvmEvent) {
    return eventIs(event, context.assetManager, "ContractChanged");
}