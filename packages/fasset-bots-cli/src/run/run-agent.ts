import "dotenv/config";
import "source-map-support/register";

import { AgentBotRunner } from "@flarelabs/fasset-bots-core";
import { createBotConfig, getSecrets, loadAgentConfigFile, requireSecret } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3, requireEnv, toplevelRun } from "@flarelabs/fasset-bots-core/utils";

const OWNER_ADDRESS: string = requireSecret("owner.native_address");
const OWNER_PRIVATE_KEY: string = requireSecret("owner.native_private_key");
const OWNER_UNDERLYING_ADDRESS: string = requireSecret("owner.underlying_address");
const OWNER_UNDERLYING_PRIVATE_KEY: string = requireSecret("owner.underlying_private_key");
const FASSET_BOT_CONFIG: string = requireEnv("FASSET_BOT_CONFIG");

toplevelRun(async () => {
    const runConfig = loadAgentConfigFile(FASSET_BOT_CONFIG);
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
