import "dotenv/config";
import "source-map-support/register";

import { ActorBaseKind, ActorBaseRunner } from "@flarelabs/fasset-bots-core";
import { createBotConfig, getSecrets, loadConfigFile, requireSecret } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3, toplevelRun } from "@flarelabs/fasset-bots-core/utils";

const CHALLENGER_ADDRESS: string = requireSecret("challenger.native_address");
const CHALLENGER_PRIVATE_KEY: string = requireSecret("challenger.native_private_key");
const FASSET_BOT_CONFIG: string = "./run-config/run-config-challenger-coston-testxrp.json";
const fAssetSymbol = "FtestXRP";

toplevelRun(async () => {
    const runConfig = loadConfigFile(FASSET_BOT_CONFIG);
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), [CHALLENGER_PRIVATE_KEY], null);
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
