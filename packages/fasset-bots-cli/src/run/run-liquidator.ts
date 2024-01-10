import "dotenv/config";
import "source-map-support/register";

import { ActorBaseKind, ActorBaseRunner } from "@flarelabs/fasset-bots-core";
import { createBotConfig, getSecrets, loadConfigFile, requireSecret } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3, requireEnv, toplevelRun } from "@flarelabs/fasset-bots-core/utils";

const LIQUIDATOR_ADDRESS: string = requireSecret("liquidator.address");
const LIQUIDATOR_PRIVATE_KEY: string = requireSecret("liquidator.private_key");
const FASSET_BOT_CONFIG: string = requireEnv("FASSET_BOT_CONFIG");

toplevelRun(async () => {
    const runConfig = loadConfigFile(FASSET_BOT_CONFIG);
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), [LIQUIDATOR_PRIVATE_KEY], null);
    const config = await createBotConfig(runConfig, LIQUIDATOR_ADDRESS);
    const runners = await Promise.all(config.fAssets.map(
        (chainConfig) => ActorBaseRunner.create(config, LIQUIDATOR_ADDRESS, ActorBaseKind.LIQUIDATOR, chainConfig)
    ));
    // run
    console.log("Liquidator bot started, press CTRL+C to end");
    process.on("SIGINT", () => {
        console.log("Liquidator bot stopping...");
        runners.forEach(runner => runner.requestStop());
    });
    await Promise.allSettled(runners.map(
        runner => runner.run(ActorBaseKind.LIQUIDATOR))
    );
    console.log("Liquidator bot stopped");
});
