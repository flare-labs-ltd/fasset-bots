import "dotenv/config";
import "source-map-support/register";

import { AgentBotRunner } from "@flarelabs/fasset-bots-core";
import { createBotConfig, decodedChainId, getSecrets, loadAgentConfigFile, requireSecret } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3, requireEnv, toplevelRun } from "@flarelabs/fasset-bots-core/utils";

const OWNER_ADDRESS: string = requireSecret("owner.native.address");
const OWNER_PRIVATE_KEY: string = requireSecret("owner.native.private_key");
const FASSET_BOT_CONFIG: string = requireEnv("FASSET_BOT_CONFIG");

toplevelRun(async () => {
    const runConfig = loadAgentConfigFile(FASSET_BOT_CONFIG);
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), [OWNER_PRIVATE_KEY], null);
    const botConfig = await createBotConfig(runConfig, OWNER_ADDRESS);
    // create runner and agents
    const runner = await AgentBotRunner.create(botConfig);
    // store owner's underlying address
    for (const ctx of runner.contexts.values()) {
        const chainName = decodedChainId(ctx.chainInfo.chainId);
        const ownerUnderlyingAddress = requireSecret(`owner.${chainName}.address`);
        const ownerUnderlyingPrivateKey = requireSecret(`owner.${chainName}.private_key`);
        await ctx.wallet.addExistingAccount(ownerUnderlyingAddress, ownerUnderlyingPrivateKey);
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
