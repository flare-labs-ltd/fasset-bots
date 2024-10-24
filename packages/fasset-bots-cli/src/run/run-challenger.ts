import "dotenv/config";
import "source-map-support/register";

import { ActorBaseKind, ActorBaseRunner } from "@flarelabs/fasset-bots-core";
import { Secrets, closeBotConfig, createBotConfig, loadConfigFile } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3, logger } from "@flarelabs/fasset-bots-core/utils";
import { programWithCommonOptions, getOneDefaultToAll } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";

const program = programWithCommonOptions("bot", "all_fassets");

program.action(async () => {
    const options: { config: string; secrets: string, fasset?: string } = program.opts();
    const secrets = Secrets.load(options.secrets);
    const runConfig = loadConfigFile(options.config);
    const challengerAddress: string = secrets.required("challenger.address");
    const challengerPrivateKey: string = secrets.required("challenger.private_key");
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, secrets.optional("apiKey.native_rpc")), [challengerPrivateKey], null);
    const config = await createBotConfig("keeper", secrets, runConfig, challengerAddress);
    logger.info(`Asset manager controller is ${config.contractRetriever.assetManagerController.address}.`);
    const fassetList = getOneDefaultToAll(config.fAssets, options.fasset);
    const runners = await Promise.all(fassetList.map(
        (chainConfig) => ActorBaseRunner.create(config, challengerAddress, ActorBaseKind.CHALLENGER, chainConfig)
    ));
    // run
    try {
        console.log("Challenger bot started, press CTRL+C to end");
        const stopBot = () => {
            console.log("Challenger bot stopping...");
            runners.forEach(runner => runner.requestStop());
        }
        process.on("SIGINT", stopBot);
        process.on("SIGTERM", stopBot);
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
