import { readFileSync } from "fs";
import { TrackedStateConfigFile, createTrackedStateConfig } from "../config/BotConfig";
import { requireEnv, toplevelRun } from "../utils/helpers";
import { initWeb3 } from "../utils/web3";
import * as dotenv from "dotenv";
import { ActorBaseKind } from "../fasset-bots/ActorBase";
import { ActorBaseRunner } from "../actors/ActorBaseRunner";
dotenv.config();

const CHALLENGER_PRIVATE_KEY: string = requireEnv('NATIVE_ACCOUNT1_PRIVATE_KEY');
const RUN_CONFIG_PATH: string = "./run-config/run-config-challenger-coston-testxrp.json"

toplevelRun(async () => {
    const runConfig = JSON.parse(readFileSync(RUN_CONFIG_PATH).toString()) as TrackedStateConfigFile;
    await initWeb3(runConfig.rpcUrl, [CHALLENGER_PRIVATE_KEY], null);
    const config = await createTrackedStateConfig(runConfig);
    const runner = await ActorBaseRunner.create(config, runConfig.ownerAddress, ActorBaseKind.CHALLENGER);
    // run
    console.log("Challenger bot started, press CTRL+C to end");
    process.on('SIGINT', () => {
        runner.requestStop();
    });
    await runner.run();
    console.log("Challenger bot stopped");
});
