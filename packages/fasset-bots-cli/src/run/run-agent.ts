import "dotenv/config";
import "source-map-support/register";

import { AgentBotRunner, TimeKeeperService, TimekeeperTimingConfig } from "@flarelabs/fasset-bots-core";
import { Secrets, closeBotConfig, createBotConfig, loadAgentConfigFile } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3 } from "@flarelabs/fasset-bots-core/utils";
import { programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";

const timekeeperConfig: TimekeeperTimingConfig = {
    queryWindow: "auto",
    updateIntervalMs: 300_000,
    loopDelayMs: 5000,
    maxUnderlyingTimestampAgeS: 60,
    maxUpdateTimeDelayMs: 30_000,
}

const program = programWithCommonOptions("agent", "all_fassets");

program.action(async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const options: { config: string; secrets: string } = program.opts();
        const secrets = Secrets.load(options.secrets);
        const runConfig = loadAgentConfigFile(options.config);
        const ownerAddress: string = secrets.required("owner.native.address");
        const ownerPrivateKey: string = secrets.required("owner.native.private_key");
        await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, secrets.optional("apiKey.native_rpc")), [ownerPrivateKey], ownerAddress);
        const botConfig = await createBotConfig("agent", secrets, runConfig, ownerAddress);
        // create timekeepers
        const timekeeperService = await TimeKeeperService.create(botConfig, ownerAddress, timekeeperConfig);
        timekeeperService.startAll();
        // create runner and agents
        const runner = await AgentBotRunner.create(secrets, botConfig, timekeeperService);
        // store owner's underlying address
        for (const ctx of runner.contexts.values()) {
            const chainName = ctx.chainInfo.chainId.chainName;
            const ownerUnderlyingAddress = secrets.required(`owner.${chainName}.address`);
            const ownerUnderlyingPrivateKey = secrets.required(`owner.${chainName}.private_key`);
            await ctx.wallet.addExistingAccount(ownerUnderlyingAddress, ownerUnderlyingPrivateKey);
        }
        // run
        try {
            console.log("Agent bot started, press CTRL+C to end");
            process.on("SIGINT", () => {
                console.log("Stopping agent bot...");
                runner.requestStop();
            });
            await runner.run();
        } finally {
            await timekeeperService.stopAll();
            await closeBotConfig(botConfig);
        }
        if (runner.stopRequested) {
            break;
        } else if (runner.restartRequested) {
            console.log("Agent bot restarting...");
            continue;
        }
        break;
    }
    console.log("Agent bot stopped");
});

toplevelRun(async () => {
    await program.parseAsync();
});
