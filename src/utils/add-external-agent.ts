import "dotenv/config";
import { web3, initWeb3, authenticatedHttpProvider } from "../utils/web3";
import { createAssetContext } from "../config/create-asset-context";
import { createBotConfig } from "../config/BotConfig";
import { loadConfigFile } from "../config/BotConfig";
import { AgentEntity, DailyProofState } from "../entities/agent";
import { getSecrets } from "../config/secrets";

/**
 * To migrate an agent from another database, you need to copy-paste the agent's
 * underlying account from `wallet_address` table, and also add the agent to the
 * `agent` table. For the latter, you can use this function.
 * @param agentVaultAddress - the agent's vault address
 * @param fAssetSymbol - the agent's fAsset symbol
 * @param runConfigFile - the run config file
 * @param fromBlock - the block number from which the agent should start listening
 * @param active - whether the agent was not destroyed (defaults to true)
 */
export async function addExternalAgentVault(
    agentVaultAddress: string,
    fAssetSymbol: string,
    runConfigFile: string,
    fromBlock?: number,
    active = true
): Promise<void> {
    const runConfig = loadConfigFile(runConfigFile);
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), null, null);
    const botConfig = await createBotConfig(runConfig, "0x");
    const chainConfig = botConfig.fAssets.find((cc) => cc.fAssetSymbol === fAssetSymbol);
    const assetContext = await createAssetContext(botConfig, chainConfig!);
    const agentInfo = await assetContext.assetManager.getAgentInfo(agentVaultAddress);
    // check if agent exists
    const agent = await botConfig.orm!.em.findOne(AgentEntity, { vaultAddress: agentVaultAddress });
    if (agent) {
        return console.log('agent already in the database');
    }
    // get the owner address
    let ownerAddress = agentInfo.ownerWorkAddress;
    if (ownerAddress === '0x0000000000000000000000000000000000000000')
        ownerAddress = agentInfo.ownerManagementAddress;
    // create new agent
    await botConfig.orm!.em.transactional(async (em) => {
        const lastBlock = await web3.eth.getBlockNumber();
        const newAgent = new AgentEntity();
        newAgent.vaultAddress = agentVaultAddress;
        newAgent.collateralPoolAddress = agentInfo.collateralPool;
        newAgent.chainId = assetContext.chainInfo.chainId;
        newAgent.chainSymbol = assetContext.chainInfo.symbol;
        newAgent.ownerAddress = ownerAddress;
        newAgent.underlyingAddress = agentInfo.underlyingAddressString;
        newAgent.active = active;
        newAgent.currentEventBlock = fromBlock ?? lastBlock + 1;
        newAgent.dailyProofState = DailyProofState.OBTAINED_PROOF;
        em.persist(newAgent);
    })
}