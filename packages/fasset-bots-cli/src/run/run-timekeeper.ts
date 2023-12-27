import "dotenv/config";
import "source-map-support/register";

import { ActorBaseKind, TimeKeeper } from "@flarelabs/fasset-bots-core";
import { createActorAssetContext, createBotConfig, getSecrets, loadConfigFile, requireSecret } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3, sleep, toplevelRun } from "@flarelabs/fasset-bots-core/utils";

const TIMEKEEPER_ADDRESS: string = requireSecret("timeKeeper.native_address");
const TIMEKEEPER_PRIVATE_KEY: string = requireSecret("timeKeeper.native_private_key");
const RUN_CONFIG_PATH: string = "./run-config/run-config-timeKeeper-coston-testxrp.json";
const INTERVAL: number = 120_000; // in ms

toplevelRun(async () => {
    const runConfig = loadConfigFile(RUN_CONFIG_PATH);
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), [TIMEKEEPER_PRIVATE_KEY], null);
    const config = await createBotConfig(runConfig, TIMEKEEPER_ADDRESS);
    const timekeepers: TimeKeeper[] = [];
    for (const chain of config.fAssets) {
        const assetContext = await createActorAssetContext(config, chain, ActorBaseKind.TIME_KEEPER);
        const timekeeper = new TimeKeeper(TIMEKEEPER_ADDRESS, assetContext, INTERVAL);
        timekeepers.push(timekeeper);
        timekeeper.run();
        // to avoid 'nonce too low' and 'replacement transaction underpriced'
        await sleep(config.loopDelay);
    }
    // run
    console.log("Timekeeper bot started, press CTRL+C to end");
    await new Promise<void>((resolve) => {
        process.on("SIGINT", () => {
            console.log("Timekeeper bot stopping...");
            resolve();
        });
    });
    for (const timekeeper of timekeepers) {
        timekeeper.clear();
    }
    console.log("Timekeeper bot stopped");
});
