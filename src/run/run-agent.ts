import "dotenv/config";
import "source-map-support/register";

import { AgentBotRunner } from "../actors/AgentBotRunner";
import { createBotConfig, decodedChainId, loadAgentConfigFile } from "../config/BotConfig";
import { requireEnv, toplevelRun } from "../utils/helpers";
import { requireSecret } from "../config/secrets";
import { authenticatedHttpProvider, initWeb3 } from "../utils/web3";
import { getSecrets } from "../config/secrets";

const OWNER_ADDRESS: string = requireSecret("owner.native.address");
const OWNER_PRIVATE_KEY: string = requireSecret("owner.native.private_key");
const RUN_CONFIG_PATH: string = requireEnv("RUN_CONFIG_PATH");

toplevelRun(async () => {
    const runConfig = loadAgentConfigFile(RUN_CONFIG_PATH);
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), [OWNER_PRIVATE_KEY], null);
    const botConfig = await createBotConfig(runConfig, OWNER_ADDRESS);
    // create runner and agents
    const runner = await AgentBotRunner.create(botConfig);
    // store owner's underlying address
    for (const ctxMap of runner.contexts) {
        const ownerUnderlyingAddress = requireSecret(`owner.${decodedChainId(ctxMap[1].chainInfo.chainId)}.address`);
        const ownerUnderlyingPrivateKey = requireSecret(`owner.${decodedChainId(ctxMap[1].chainInfo.chainId)}.private_key`);
        await ctxMap[1].wallet.addExistingAccount(ownerUnderlyingAddress, ownerUnderlyingPrivateKey);
    }
    // run
    console.log("Agent bot started, press CTRL+C to end");
    process.on("SIGINT", () => {
        console.log("Stopping agent bot...");
        runner.requestStop();
    });
    await runner.run();
    console.log("Agent bot stopped");
});
