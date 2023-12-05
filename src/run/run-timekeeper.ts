import "dotenv/config";
import "source-map-support/register";

import { TimeKeeper } from "../actors/TimeKeeper";
import { createBotConfig, loadConfigFile } from "../config/BotConfig";
import { createActorAssetContext } from "../config/create-asset-context";
import { sleep, toplevelRun } from "../utils/helpers";
import { requireSecret } from "../config/secrets";
import { authenticatedHttpProvider, initWeb3 } from "../utils/web3";
import { ActorBaseKind } from "../fasset-bots/ActorBase";
import { getSecrets } from "../config/secrets";

const TIMEKEEPER_ADDRESS: string = requireSecret("timeKeeper.address");
const TIMEKEEPER_PRIVATE_KEY: string = requireSecret("timeKeeper.private_key");
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
