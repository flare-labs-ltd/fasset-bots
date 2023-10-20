import "dotenv/config";

import { ActorBaseRunner } from "../actors/ActorBaseRunner";
import { createBotConfig, loadConfigFile } from "../config/BotConfig";
import { ActorBaseKind } from "../fasset-bots/ActorBase";
import { requireEnv, toplevelRun } from "../utils/helpers";
import { authenticatedHttpProvider, initWeb3 } from "../utils/web3";

const CHALLENGER_ADDRESS: string = requireEnv("NATIVE_ACCOUNT1");
const CHALLENGER_PRIVATE_KEY: string = requireEnv("NATIVE_ACCOUNT1_PRIVATE_KEY");
const RUN_CONFIG_PATH: string = "./run-config/run-config-challenger-coston-testxrp.json";
const fAssetSymbol = "FtestXRP";

toplevelRun(async () => {
    const runConfig = loadConfigFile(RUN_CONFIG_PATH);
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, process.env.NATIVE_RPC_API_KEY), [CHALLENGER_PRIVATE_KEY], null);
    const config = await createBotConfig(runConfig, CHALLENGER_ADDRESS);
    const chainConfig = config.fAssets.find((cc) => cc.fAssetSymbol === fAssetSymbol);
    if (chainConfig == null) {
        console.log(`Invalid FAsset symbol ${fAssetSymbol}`);
        throw Error(`Invalid FAsset symbol ${fAssetSymbol}`);
    }
    const runner = await ActorBaseRunner.create(config, CHALLENGER_ADDRESS, ActorBaseKind.CHALLENGER, chainConfig);
    // run
    console.log("Challenger bot started, press CTRL+C to end");
    process.on("SIGINT", () => {
        runner.requestStop();
    });
    await runner.run(ActorBaseKind.CHALLENGER);
    console.log("Challenger bot stopped");
});
