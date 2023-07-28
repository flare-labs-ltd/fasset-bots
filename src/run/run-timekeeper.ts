import * as dotenv from "dotenv";
import { readFileSync } from "fs";
import { TimeKeeper } from "../actors/TimeKeeper";
import { TrackedStateConfigFile, createTrackedStateConfig } from "../config/BotConfig";
import { createTrackedStateAssetContext } from "../config/create-asset-context";
import { Future, requireEnv, sleep, toplevelRun } from "../utils/helpers";
import { initWeb3 } from "../utils/web3";

dotenv.config();

const TIMEKEEPER_ADDRESS: string = requireEnv('NATIVE_ACCOUNT1');
const TIMEKEEPER_PRIVATE_KEY: string = requireEnv('NATIVE_ACCOUNT1_PRIVATE_KEY');
const RUN_CONFIG_PATH: string = "./run-config/run-config-challenger-coston-testxrp.json"

toplevelRun(async () => {
    const runConfig = JSON.parse(readFileSync(RUN_CONFIG_PATH).toString()) as TrackedStateConfigFile;
    await initWeb3(runConfig.rpcUrl, [TIMEKEEPER_PRIVATE_KEY], null);
    const config = await createTrackedStateConfig(runConfig, TIMEKEEPER_ADDRESS);
    const timekeepers: TimeKeeper[] = [];
    for (const chain of config.chains) {
        const assetContext = await createTrackedStateAssetContext(config, chain);
        const timekeeper = new TimeKeeper(TIMEKEEPER_ADDRESS, assetContext, 120_000);
        timekeepers.push(timekeeper);
        timekeeper.run();
    }
    // run
    console.log("Timekeeper bot started, press CTRL+C to end");
    const stopped = new Future<boolean>();
    process.on('SIGINT', () => {
        console.log("Timekeeper bot stopping...");
        for (const timekeeper of timekeepers) {
            timekeeper.clear();
        }
        stopped.resolve(true);
    });
    await stopped.promise;
    console.log("Timekeeper bot stopped");
});
