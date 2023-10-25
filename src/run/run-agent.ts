import "dotenv/config";

import { AgentBotRunner } from "../actors/AgentBotRunner";
import { createBotConfig, loadAgentConfigFile } from "../config/BotConfig";
import { requireConfigVariable, requireEnv, toplevelRun } from "../utils/helpers";
import { authenticatedHttpProvider, initWeb3 } from "../utils/web3";
import { defineAppConfig } from "../config/AppConfig";

const OWNER_ADDRESS: string = requireConfigVariable("owner.native_address");
const OWNER_PRIVATE_KEY: string = requireConfigVariable("owner.native_private_key");
const OWNER_UNDERLYING_ADDRESS: string = requireConfigVariable("owner.underlying_address");
const OWNER_UNDERLYING_PRIVATE_KEY: string = requireConfigVariable("owner.underlying_private_key");
const RUN_CONFIG_PATH: string = requireEnv("RUN_CONFIG_PATH");

toplevelRun(async () => {
    const runConfig = loadAgentConfigFile(RUN_CONFIG_PATH);
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, defineAppConfig().apiKey.native_rpc), [OWNER_PRIVATE_KEY], null);
    const botConfig = await createBotConfig(runConfig, OWNER_ADDRESS);
    // create runner and agents
    const runner = await AgentBotRunner.create(botConfig);
    // store owner's underlying address
    for (const ctxMap of runner.contexts) {
        await ctxMap[1].wallet.addExistingAccount(OWNER_UNDERLYING_ADDRESS, OWNER_UNDERLYING_PRIVATE_KEY);
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
