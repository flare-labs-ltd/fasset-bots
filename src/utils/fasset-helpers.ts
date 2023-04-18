import { AgentInfo, AgentSettings } from "../fasset/AssetManagerTypes";
import { BN_ZERO, toBN } from "./helpers";

export async function getAgentSettings(agentInfo: AgentInfo): Promise<AgentSettings> {
    const agentSettings = {
        class1CollateralToken: "",
        feeBIPS: BN_ZERO,
        poolFeeShareBIPS: BN_ZERO,
        mintingClass1CollateralRatioBIPS: BN_ZERO,
        mintingPoolCollateralRatioBIPS: BN_ZERO,
        poolExitCollateralRatioBIPS: BN_ZERO,
        buyFAssetByAgentFactorBIPS: BN_ZERO,
        poolTopupCollateralRatioBIPS: BN_ZERO,
        poolTopupTokenPriceFactorBIPS: BN_ZERO
    } as AgentSettings;
    Object.defineProperty(agentSettings, 'class1CollateralToken', { value: agentInfo.class1CollateralToken });
    Object.defineProperty(agentSettings, 'feeBIPS', { value: toBN(agentInfo.feeBIPS) });
    Object.defineProperty(agentSettings, 'poolFeeShareBIPS', { value: toBN(agentInfo.poolFeeShareBIPS) });
    Object.defineProperty(agentSettings, 'mintingClass1CollateralRatioBIPS', { value: toBN(agentInfo.mintingClass1CollateralRatioBIPS) });
    Object.defineProperty(agentSettings, 'mintingPoolCollateralRatioBIPS', { value: toBN(agentInfo.mintingPoolCollateralRatioBIPS) });
    Object.defineProperty(agentSettings, 'poolExitCollateralRatioBIPS', { value: toBN(agentInfo.poolExitCollateralRatioBIPS) });
    Object.defineProperty(agentSettings, 'buyFAssetByAgentFactorBIPS', { value: toBN(agentInfo.buyFAssetByAgentFactorBIPS) });
    Object.defineProperty(agentSettings, 'poolTopupCollateralRatioBIPS', { value: toBN(agentInfo.poolTopupCollateralRatioBIPS) });
    Object.defineProperty(agentSettings, 'poolTopupTokenPriceFactorBIPS', { value: toBN(agentInfo.poolTopupTokenPriceFactorBIPS) });
    return agentSettings;
}