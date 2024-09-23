import "dotenv/config";
import "source-map-support/register";

import { ActorBaseKind, ActorBaseRunner } from "@flarelabs/fasset-bots-core";
import { BotConfig, BotFAssetConfig, Secrets, closeBotConfig, createBotConfig, loadConfigFile } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3, logger } from "@flarelabs/fasset-bots-core/utils";
import { programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";

const program = programWithCommonOptions("bot", "all_fassets");

function extractFAssetListFromBotConfig(config: BotConfig, fasset?: string): BotFAssetConfig[] {
    if (fasset === undefined) {
        return Array.from(config.fAssets.values());
    }
    const fassetConfig = config.fAssets.get(fasset);
    if (fassetConfig === undefined) {
        throw new Error(`FAsset ${fasset} not found in config`);
    }
    return [fassetConfig];
}

program.action(async () => {
    const options: { config: string; secrets: string; fasset?: string } = program.opts();
    const secrets = Secrets.load(options.secrets);
    const runConfig = loadConfigFile(options.config);
    const liquidatorAddress: string = secrets.required("liquidator.address");
    const liquidatorPrivateKey: string = secrets.required("liquidator.private_key");
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, secrets.optional("apiKey.native_rpc")), [liquidatorPrivateKey], null);
    const config = await createBotConfig("common", secrets, runConfig, liquidatorAddress);
    logger.info(`Asset manager controller is ${config.contractRetriever.assetManagerController.address}.`);
    const fassetList = extractFAssetListFromBotConfig(config, options.fasset);
    console.log(fassetList.length, fassetList, options.fasset);
    const runners = await Promise.all(fassetList.map(
        (chainConfig) => ActorBaseRunner.create(config, liquidatorAddress, ActorBaseKind.LIQUIDATOR, chainConfig)
    ));
    // run
    try {
        console.log("Liquidator bot started, press CTRL+C to end");
        const stopBot = () => {
            console.log("Liquidator bot stopping...");
            runners.forEach(runner => runner.requestStop());
        }
        process.on("SIGINT", stopBot);
        process.on("SIGTERM", stopBot);
        await Promise.allSettled(runners.map(
            runner => runner.run(ActorBaseKind.LIQUIDATOR))
        );
    } finally {
        await closeBotConfig(config);
    }
    console.log("Liquidator bot stopped");
});

toplevelRun(async () => {
    await program.parseAsync();
});
