import "dotenv/config";
import "source-map-support/register";

import { ActorBaseRunner } from "../actors/ActorBaseRunner";
import { createBotConfig, loadConfigFile } from "../config/BotConfig";
import { ActorBaseKind } from "../fasset-bots/ActorBase";
import { toplevelRun } from "../utils/helpers";
import { requireSecret } from "../config/secrets";
import { authenticatedHttpProvider, initWeb3 } from "../utils/web3";
import { getSecrets } from "../config/secrets";

const LIQUIDATOR_ADDRESS: string = requireSecret("liquidator.native_address");
const LIQUIDATOR_PRIVATE_KEY: string = requireSecret("liquidator.native_private_key");
const RUN_CONFIG_PATH: string = "./run-config/run-config-liquidator-coston-testxrp.json";
const fAssetSymbol = "FfakeXRP";

toplevelRun(async () => {
    const runConfig = loadConfigFile(RUN_CONFIG_PATH);
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), [LIQUIDATOR_PRIVATE_KEY], null);
    const config = await createBotConfig(runConfig, LIQUIDATOR_ADDRESS);
    const chainConfig = config.fAssets.find((cc) => cc.fAssetSymbol === fAssetSymbol);
    if (chainConfig == null) {
        console.log(`Invalid FAsset symbol ${fAssetSymbol}`);
        throw Error(`Invalid FAsset symbol ${fAssetSymbol}`);
    }
    const runner = await ActorBaseRunner.create(config, LIQUIDATOR_ADDRESS, ActorBaseKind.LIQUIDATOR, chainConfig);
    // run
    console.log("Liquidator bot started, press CTRL+C to end");
    process.on("SIGINT", () => {
        runner.requestStop();
    });
    await runner.run(ActorBaseKind.LIQUIDATOR);
    console.log("Liquidator bot stopped");
});
