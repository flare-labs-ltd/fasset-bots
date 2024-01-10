import "dotenv/config";
import "source-map-support/register";

import { ActorBaseKind, ActorBaseRunner } from "@flarelabs/fasset-bots-core";
import { createBotConfig, getSecrets, loadConfigFile, requireSecret } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3, requireEnv, toplevelRun } from "@flarelabs/fasset-bots-core/utils";

const SYSTEM_KEEPER_ADDRESS: string = requireSecret("systemKeeper.address");
const SYSTEM_KEEPER_PRIVATE_KEY: string = requireSecret("systemKeeper.private_key");
const FASSET_BOT_CONFIG: string = requireEnv("FASSET_BOT_CONFIG");

toplevelRun(async () => {
    const runConfig = loadConfigFile(FASSET_BOT_CONFIG);
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), [SYSTEM_KEEPER_PRIVATE_KEY], null);
    const config = await createBotConfig(runConfig, SYSTEM_KEEPER_ADDRESS);
    const runners = await Promise.all(config.fAssets.map(
        (chainConfig) => ActorBaseRunner.create(config, SYSTEM_KEEPER_ADDRESS, ActorBaseKind.SYSTEM_KEEPER, chainConfig)
    ));
    // run
    console.log("System keeper bot started, press CTRL+C to end");
    process.on("SIGINT", () => {
        console.log("System keeper bot stopping...");
        runners.forEach(runner => runner.requestStop());
    });
    await Promise.allSettled(runners.map(
        runner => runner.run(ActorBaseKind.SYSTEM_KEEPER))
    );
    console.log("System keeper bot stopped");
});
