import "dotenv/config";
import "source-map-support/register";

import { ActorBaseKind, ActorBaseRunner } from "@flarelabs/fasset-bots-core";
import { Secrets, closeBotConfig, createBotConfig, loadConfigFile } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3 } from "@flarelabs/fasset-bots-core/utils";
import { programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";

const program = programWithCommonOptions("bot", "all_fassets");

program.action(async () => {
    const options: { config: string; secrets: string } = program.opts();
    const secrets = Secrets.load(options.secrets);
    const runConfig = loadConfigFile(options.config);
    const challengerAddress: string = secrets.required("challenger.address");
    const challengerPrivateKey: string = secrets.required("challenger.private_key");
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, secrets.optional("apiKey.native_rpc")), [challengerPrivateKey], null);
    const config = await createBotConfig("keeper", secrets, runConfig, challengerAddress);
    const fassetList = Array.from(config.fAssets.values());
    const runners = await Promise.all(fassetList.map(
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
