import "dotenv/config";
import "source-map-support/register";

import { AgentBotRunner } from "@flarelabs/fasset-bots-core";
import { createBotConfig, decodedChainId, getSecrets, loadAgentConfigFile, requireSecret } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3, toplevelRun } from "@flarelabs/fasset-bots-core/utils";
import { programWithCommonOptions } from "../utils/program";

const program = programWithCommonOptions("bot", "all_fassets");

program.action(async () => {
    const options: { config: string } = program.opts();
    const runConfig = loadAgentConfigFile(options.config);
    const ownerAddress: string = requireSecret("owner.native.address");
    const ownerPrivateKey: string = requireSecret("owner.native.private_key");
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), [ownerPrivateKey], null);
    const botConfig = await createBotConfig(runConfig, ownerAddress);
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

toplevelRun(async () => {
    await program.parseAsync();
});
