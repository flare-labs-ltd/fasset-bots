import "dotenv/config";
import "source-map-support/register";

import { ActorBaseKind, ActorBaseRunner } from "@flarelabs/fasset-bots-core";
import { closeBotConfig, createBotConfig, getSecrets, loadConfigFile, requireSecret } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3, toplevelRun } from "@flarelabs/fasset-bots-core/utils";
import { programWithCommonOptions } from "../utils/program";

const program = programWithCommonOptions("bot", "all_fassets");

program.action(async () => {
    const options: { config: string } = program.opts();
    const runConfig = loadConfigFile(options.config);
    const challengerAddress: string = requireSecret("challenger.address");
    const challengerPrivateKey: string = requireSecret("challenger.private_key");
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), [challengerPrivateKey], null);
    const config = await createBotConfig(runConfig, challengerAddress);
    const runners = await Promise.all(config.fAssets.map(
        (chainConfig) => ActorBaseRunner.create(config, challengerAddress, ActorBaseKind.CHALLENGER, chainConfig)
    ));
    // run
    try {
        console.log("Challenger bot started, press CTRL+C to end");
        process.on("SIGINT", () => {
            console.log("Challenger bot stopping...");
            runners.forEach(runner => runner.requestStop());
        });
        await Promise.allSettled(runners.map(
            runner => runner.run(ActorBaseKind.CHALLENGER))
        );
    } finally {
        await closeBotConfig(config);
    }
    console.log("Challenger bot stopped");
});

toplevelRun(async () => {
    await program.parseAsync();
});
