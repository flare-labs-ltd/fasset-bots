import "dotenv/config";
import "source-map-support/register";

import { ActorBaseKind, ActorBaseRunner } from "fasset-bots-core-lib";
import { BotConfigFile, createBotConfig, getSecrets, requireSecret } from "fasset-bots-core-lib/config";
import { authenticatedHttpProvider, initWeb3, toplevelRun } from "fasset-bots-core-lib/utils";
import { readFileSync } from "fs";

const SYSTEM_KEEPER_ADDRESS: string = requireSecret("systemKeeper.native_address");
const SYSTEM_KEEPER_PRIVATE_KEY: string = requireSecret("systemKeeper.native_private_key");
const RUN_CONFIG_PATH: string = "./run-config/run-config-challenger-coston-testxrp.json";
const fAssetSymbol = "FfakeXRP";

toplevelRun(async () => {
    const runConfig = JSON.parse(readFileSync(RUN_CONFIG_PATH).toString()) as BotConfigFile;
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), [SYSTEM_KEEPER_PRIVATE_KEY], null);
    const config = await createBotConfig(runConfig, SYSTEM_KEEPER_ADDRESS);
    const chainConfig = config.fAssets.find((cc) => cc.fAssetSymbol === fAssetSymbol);
    if (chainConfig == null) {
        console.log(`Invalid FAsset symbol ${fAssetSymbol}`);
        throw Error(`Invalid FAsset symbol ${fAssetSymbol}`);
    }
    const runner = await ActorBaseRunner.create(config, SYSTEM_KEEPER_ADDRESS, ActorBaseKind.SYSTEM_KEEPER, chainConfig);
    // run
    console.log("System keeper bot started, press CTRL+C to end");
    process.on("SIGINT", () => {
        runner.requestStop();
    });
    await runner.run(ActorBaseKind.SYSTEM_KEEPER);
    console.log("System keeper bot stopped");
});
