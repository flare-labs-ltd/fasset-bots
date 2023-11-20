import { AssetManagerInstance } from "../../typechain-truffle/AssetManager";
import { AssetManagerEvents, IAssetNativeChainContext } from "../fasset-bots/IAssetBotContext";
import { AgentInfo, AgentSettings, AgentStatus } from "../fasset/AssetManagerTypes";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { BlockchainIndexerHelper } from "../underlying-chain/BlockchainIndexerHelper";
import { IBlock } from "../underlying-chain/interfaces/IBlockChain";
import { ContractWithEvents } from "./events/truffle";
import { toBN, toNumber } from "./helpers";
import { web3DeepNormalize } from "./web3normalize";
import { artifacts } from "./web3";

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
    assetManager: ContractWithEvents<AssetManagerInstance, AssetManagerEvents>,
    caller: string,
    queryWindow: number = 7200 // don't need 1 day long query to prove last block
): Promise<number> {
    const proof = await attestationProvider.proveConfirmedBlockHeightExists(queryWindow);
    await assetManager.updateCurrentBlock(web3DeepNormalize(proof), { from: caller });
    return toNumber(proof.data.requestBody.blockNumber) + toNumber(proof.data.responseBody.numberOfConfirmations);
}

export async function attestationWindowSeconds(assetManager: ContractWithEvents<AssetManagerInstance, AssetManagerEvents>): Promise<number> {
    const settings = await assetManager.getSettings();
    return Number(settings.attestationWindowSeconds);
}

export async function latestUnderlyingBlock(blockchainIndexer: BlockchainIndexerHelper): Promise<IBlock | null> {
    const blockHeight = await blockchainIndexer.getBlockHeight();
    const latestBlock = await blockchainIndexer.getBlockAt(blockHeight);
    return latestBlock;
}

export async function printAgentInfo(vaultAddress: string, context: IAssetNativeChainContext) {
    const IERC20 = artifacts.require("IERC20Metadata");
    const fAsset = context.fAsset;
    const assetManager = context.assetManager;
    const settings = await assetManager.getSettings();
    const lotSizeUBA = Number(settings.lotSizeAMG) * Number(settings.assetMintingGranularityUBA);
    const symbol = await fAsset.symbol();
    const info = await assetManager.getAgentInfo(vaultAddress);
    const vaultCollateral = await IERC20.at(info.vaultCollateralToken);
    const [vcSymbol, vcDec] = [await vaultCollateral.symbol(), await vaultCollateral.decimals()];
    for (const [key, value] of Object.entries(info)) {
        if (typeof key === "number" || /^\d+$/.test(key)) continue;
        if (key === "status") {
            /* istanbul ignore next */
            console.log(`${key}: ${AgentStatus[Number(value)] ?? value}`);
        } else if (/UBA$/i.test(key)) {
            const amount = Number(value) / Number(settings.assetUnitUBA);
            const lots = Number(value) / lotSizeUBA;
            console.log(`${key.slice(0, key.length - 3)}: ${amount.toFixed(2)} ${symbol}  (${lots.toFixed(2)} lots)`);
        } else if (/RatioBIPS$/i.test(key)) {
            const amount = Number(value) / 10000;
            console.log(`${key.slice(0, key.length - 4)}: ${amount.toFixed(3)}`);
        } else if (/BIPS$/i.test(key)) {
            const percent = Number(value) / 100;
            console.log(`${key.slice(0, key.length - 4)}: ${percent.toFixed(2)}%`);
        } else if (/NATWei$/i.test(key)) {
            const amount = Number(value) / 1e18;
            console.log(`${key.slice(0, key.length - 6)}: ${amount.toFixed(2)} NAT`);
        } else if (/Wei$/i.test(key)) {
            const [symbol, decimals] = /VaultCollateral/i.test(key)
                ? [vcSymbol, Number(vcDec)]
                : /PoolTokens/i.test(key)
                ? ["POOLTOK", 18]
                : /* istanbul ignore next */
                  ["???", 18];
            const amount = Number(value) / 10 ** decimals;
            console.log(`${key.slice(0, key.length - 3)}: ${amount.toFixed(2)} ${symbol}`);
        } else {
            console.log(`${key}: ${value}`);
        }
    }
}
