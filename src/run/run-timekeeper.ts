import "dotenv/config";

import { disableMccTraceManager } from "../../test-hardhat/test-utils/helpers";
import { TimeKeeper } from "../actors/TimeKeeper";
import { createBotConfig, loadConfigFile } from "../config/BotConfig";
import { createActorAssetContext } from "../config/create-asset-context";
import { requireEnv, sleep, toplevelRun } from "../utils/helpers";
import { authenticatedHttpProvider, initWeb3 } from "../utils/web3";
import { ActorBaseKind } from "../fasset-bots/ActorBase";

const TIMEKEEPER_ADDRESS: string = requireEnv("NATIVE_ACCOUNT3");
const TIMEKEEPER_PRIVATE_KEY: string = requireEnv("NATIVE_ACCOUNT3_PRIVATE_KEY");
const RUN_CONFIG_PATH: string = "./run-config/run-config-timeKeeper-coston-testxrp.json";
const INTERVAL: number = 120_000; // in ms

toplevelRun(async () => {
    // to avoid RangeError: Map maximum size exceeded in /home/fasset-bots/simple-wallet/node_modules/@flarenetwork/mcc/dist/src/utils/trace.js:18:44
    disableMccTraceManager();
    const runConfig = loadConfigFile(RUN_CONFIG_PATH);
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, process.env.NATIVE_RPC_API_KEY), [TIMEKEEPER_PRIVATE_KEY], null);
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
