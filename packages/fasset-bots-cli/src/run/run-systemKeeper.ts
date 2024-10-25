import "dotenv/config";
import "source-map-support/register";

import { ActorBaseKind, ActorBaseRunner } from "@flarelabs/fasset-bots-core";
import { Secrets, closeBotConfig, createBotConfig, loadConfigFile } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3, logger } from "@flarelabs/fasset-bots-core/utils";
import { programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";

const program = programWithCommonOptions("bot", "all_fassets");

program.action(async () => {
    const options: { config: string; secrets: string } = program.opts();
    const secrets = await Secrets.load(options.secrets);
    const runConfig = loadConfigFile(options.config);
    const systemKeeperAddress: string = secrets.required("systemKeeper.address");
    const systemKeeperPrivateKey: string = secrets.required("systemKeeper.private_key");
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, secrets.optional("apiKey.native_rpc")), [systemKeeperPrivateKey], null);
    const config = await createBotConfig("common", secrets, runConfig, systemKeeperAddress);
    logger.info(`Asset manager controller is ${config.contractRetriever.assetManagerController.address}.`);
    const fassetList = Array.from(config.fAssets.values());
    const runners = await Promise.all(fassetList.map(
        (chainConfig) => ActorBaseRunner.create(config, systemKeeperAddress, ActorBaseKind.SYSTEM_KEEPER, chainConfig)
    ));
    // run
    try {
        console.log("System keeper bot started, press CTRL+C to end");
        const stopBot = () => {
            console.log("System keeper bot stopping...");
            runners.forEach(runner => runner.requestStop());
        }
        process.on("SIGINT", stopBot);
        process.on("SIGTERM", stopBot);
        await Promise.allSettled(runners.map(
            runner => runner.run(ActorBaseKind.SYSTEM_KEEPER))
        );
    } finally {
        await closeBotConfig(config);
    }
    console.log("System keeper bot stopped");
});

toplevelRun(async () => {
    await program.parseAsync();
});
