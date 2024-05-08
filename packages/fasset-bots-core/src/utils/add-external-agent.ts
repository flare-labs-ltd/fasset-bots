import "dotenv/config";

import { assertNotNullCmd } from ".";
import { Secrets } from "../config";
import { createBotConfig } from "../config/BotConfig";
import { loadConfigFile } from "../config/config-file-loader";
import { createAgentBotContext } from "../config/create-asset-context";
import { AgentEntity } from "../entities/agent";
import { authenticatedHttpProvider, initWeb3, web3 } from "../utils/web3";
import { ZERO_ADDRESS } from "./helpers";

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
    secrets: Secrets,
    agentVaultAddress: string,
    fAssetSymbol: string,
    runConfigFile: string,
    fromBlock?: number,
    active = true
): Promise<void> {
    const runConfig = loadConfigFile(runConfigFile);
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, secrets.optional("apiKey.native_rpc")), null, null);
    const botConfig = await createBotConfig("agent", secrets, runConfig, "0x");
    const chainConfig = botConfig.fAssets.get(fAssetSymbol);
    assertNotNullCmd(chainConfig, `Invalid FAsset symbol ${fAssetSymbol}`);
    const assetContext = await createAgentBotContext(botConfig, chainConfig);
    const agentInfo = await assetContext.assetManager.getAgentInfo(agentVaultAddress);
    // check if agent exists
    const agent = await botConfig.orm.em.findOne(AgentEntity, { vaultAddress: agentVaultAddress });
    if (agent) {
        return console.log("agent already in the database");
    }
    // get the owner address
    let ownerAddress = agentInfo.ownerWorkAddress;
    if (ownerAddress === ZERO_ADDRESS) {
        ownerAddress = agentInfo.ownerManagementAddress;
    }
    // create new agent
    await botConfig.orm.em.transactional(async (em) => {
        const lastBlock = await web3.eth.getBlockNumber();
        const newAgent = new AgentEntity();
        newAgent.vaultAddress = agentVaultAddress;
        newAgent.collateralPoolAddress = agentInfo.collateralPool;
        newAgent.chainId = assetContext.chainInfo.chainId.sourceId;
        newAgent.chainSymbol = assetContext.chainInfo.symbol;
        newAgent.ownerAddress = ownerAddress;
        newAgent.underlyingAddress = agentInfo.underlyingAddressString;
        newAgent.active = active;
        newAgent.currentEventBlock = fromBlock ?? lastBlock + 1;
        em.persist(newAgent);
    });
}
