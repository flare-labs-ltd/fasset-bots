import { IFtsoRegistryInstance } from "../../typechain-truffle";
import { IAssetTrackedStateContext } from "../fasset-bots/IAssetBotContext";
import { AgentInfo, AgentSettings } from "../fasset/AssetManagerTypes";
import { artifacts } from "./artifacts";
import { toBN, toNumber } from "./helpers";
import { web3DeepNormalize } from "./web3normalize";

const IFtso = artifacts.require('IFtso');

export function getAgentSettings(agentInfo: AgentInfo): AgentSettings {
    const agentSettings = {} as AgentSettings;
    agentSettings.class1CollateralToken = agentInfo.class1CollateralToken;
    agentSettings.feeBIPS = toBN(agentInfo.feeBIPS);
    agentSettings.poolFeeShareBIPS = toBN(agentInfo.poolFeeShareBIPS);
    agentSettings.mintingClass1CollateralRatioBIPS = toBN(agentInfo.mintingClass1CollateralRatioBIPS);
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
export async function proveAndUpdateUnderlyingBlock(context: IAssetTrackedStateContext, caller: string) {
    const proof = await context.attestationProvider.proveConfirmedBlockHeightExists(await attestationWindowSeconds(context));
    await context.assetManager.updateCurrentBlock(web3DeepNormalize(proof), { from: caller});
    return toNumber(proof.blockNumber) + toNumber(proof.numberOfConfirmations);
}


export async function attestationWindowSeconds(context: IAssetTrackedStateContext) {
    const settings = await context.assetManager.getSettings();
    return Number(settings.attestationWindowSeconds);
}

export async function createFtsosHelper(ftsoRegistry: IFtsoRegistryInstance, symbol: string) {
    const ftsoAddress = await ftsoRegistry.getFtsoBySymbol(symbol);
    return await IFtso.at(ftsoAddress);
}