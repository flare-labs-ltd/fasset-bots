import "dotenv/config";
import "source-map-support/register";

import { AgentBotRunner } from "fasset-bots-core-lib";
import { createBotConfig, getSecrets, loadAgentConfigFile, requireSecret } from "fasset-bots-core-lib/config";
import { authenticatedHttpProvider, initWeb3, requireEnv, toplevelRun } from "fasset-bots-core-lib/utils";

const OWNER_ADDRESS: string = requireSecret("owner.native_address");
const OWNER_PRIVATE_KEY: string = requireSecret("owner.native_private_key");
const OWNER_UNDERLYING_ADDRESS: string = requireSecret("owner.underlying_address");
const OWNER_UNDERLYING_PRIVATE_KEY: string = requireSecret("owner.underlying_private_key");
const RUN_CONFIG_PATH: string = requireEnv("RUN_CONFIG_PATH");

toplevelRun(async () => {
    const runConfig = loadAgentConfigFile(RUN_CONFIG_PATH);
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), [OWNER_PRIVATE_KEY], null);
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
