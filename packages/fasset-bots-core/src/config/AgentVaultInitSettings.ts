import BN from "bn.js";
import { CollateralClass } from "..";
import { AgentSettingsConfig } from ".";
import { IJsonLoader, JsonLoader } from "./json-loader";
import { CommandLineError, resolveInFassetBotsCore, toBIPS, toBN } from "../utils";
import { IAssetAgentContext } from "../fasset-bots/IAssetBotContext";


export interface AgentVaultInitSettings {
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
    handshakeType: BN;
}

export const agentSettingsLoader: IJsonLoader<AgentSettingsConfig> =
    new JsonLoader(resolveInFassetBotsCore("run-config/schema/agent-settings.schema.json"), "agent settings JSON");

export function loadAgentSettings(fname: string) {
    try {
        return agentSettingsLoader.load(fname);
    } catch (error) {
        throw CommandLineError.wrap(error);
    }
}

/**
 * Creates agents initial settings from AgentSettingsConfig, that are needed for agent to be created.
 * @param context fasset agent bot context
 * @param agentSettingsConfigPath path to default agent configuration file
 * @param poolTokenSuffix
 * @returns instance of AgentBotDefaultSettings
 */
export async function createAgentVaultInitSettings(
    context: IAssetAgentContext,
    agentSettings: AgentSettingsConfig
): Promise<AgentVaultInitSettings> {
    const collateralTypes = await context.assetManager.getCollateralTypes();
    const vaultCollateralToken = collateralTypes.find((token) => Number(token.collateralClass) === CollateralClass.VAULT &&
        token.tokenFtsoSymbol === agentSettings.vaultCollateralFtsoSymbol &&
        toBN(token.validUntil).eqn(0));
    if (!vaultCollateralToken) {
        throw new Error(`Invalid vault collateral token ${agentSettings.vaultCollateralFtsoSymbol}`);
    }
    const agentBotSettings: AgentVaultInitSettings = {
        vaultCollateralToken: vaultCollateralToken.token,
        poolTokenSuffix: agentSettings.poolTokenSuffix,
        feeBIPS: toBIPS(agentSettings.fee),
        poolFeeShareBIPS: toBIPS(agentSettings.poolFeeShare),
        mintingVaultCollateralRatioBIPS: toBIPS(agentSettings.mintingVaultCollateralRatio),
        mintingPoolCollateralRatioBIPS: toBIPS(agentSettings.mintingPoolCollateralRatio),
        poolExitCollateralRatioBIPS: toBIPS(agentSettings.poolExitCollateralRatio),
        buyFAssetByAgentFactorBIPS: toBIPS(agentSettings.buyFAssetByAgentFactor),
        poolTopupCollateralRatioBIPS: toBIPS(agentSettings.poolTopupCollateralRatio),
        poolTopupTokenPriceFactorBIPS: toBIPS(agentSettings.poolTopupTokenPriceFactor),
        handshakeType: toBN(agentSettings.handshakeType),
    };
    return agentBotSettings;
}
