import "dotenv/config";

import { disableMccTraceManager } from "../../test-hardhat/test-utils/helpers";
import { TimeKeeper } from "../actors/TimeKeeper";
import { createBotConfig, loadConfigFile } from "../config/BotConfig";
import { createActorAssetContext } from "../config/create-asset-context";
import { Future, requireEnv, toplevelRun } from "../utils/helpers";
import { authenticatedHttpProvider, initWeb3 } from "../utils/web3";

const TIMEKEEPER_ADDRESS: string = requireEnv("NATIVE_ACCOUNT3");
const TIMEKEEPER_PRIVATE_KEY: string = requireEnv("NATIVE_ACCOUNT3_PRIVATE_KEY");
const RUN_CONFIG_PATH: string = "./run-config/run-config-challenger-coston-testxrp.json";

toplevelRun(async () => {
    // to avoid RangeError: Map maximum size exceeded in /home/fasset-bots/simple-wallet/node_modules/@flarenetwork/mcc/dist/src/utils/trace.js:18:44
    disableMccTraceManager();
    const runConfig = loadConfigFile(RUN_CONFIG_PATH);
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, process.env.NATIVE_RPC_API_KEY), [TIMEKEEPER_PRIVATE_KEY], null);
    const config = await createBotConfig(runConfig, TIMEKEEPER_ADDRESS);
    const timekeepers: TimeKeeper[] = [];
    for (const chain of config.fAssets) {
        const assetContext = await createActorAssetContext(config, chain);
        const timekeeper = new TimeKeeper(TIMEKEEPER_ADDRESS, assetContext, 120_000);
        timekeepers.push(timekeeper);
        timekeeper.run();
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
