import "dotenv/config";
import "source-map-support/register";

import { ActorBaseKind, TimeKeeper } from "@flarelabs/fasset-bots-core";
import { createActorAssetContext, createBotConfig, getSecrets, loadConfigFile, requireSecret } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3, sleep, toplevelRun } from "@flarelabs/fasset-bots-core/utils";
import { programWithCommonOptions } from "../utils/program";

const INTERVAL: number = 120_000; // in ms

const program = programWithCommonOptions("bot", "all_fassets");

program.action(async () => {
    const options: { config: string } = program.opts();
    const runConfig = loadConfigFile(options.config);
    const timekeeperAddress: string = requireSecret("timeKeeper.address");
    const timekeeperPrivateKey: string = requireSecret("timeKeeper.private_key");
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), [timekeeperPrivateKey], null);
    const config = await createBotConfig(runConfig, timekeeperAddress);
    const timekeepers: TimeKeeper[] = [];
    for (const chain of config.fAssets) {
        const assetContext = await createActorAssetContext(config, chain, ActorBaseKind.TIME_KEEPER);
        const timekeeper = new TimeKeeper(timekeeperAddress, assetContext, INTERVAL);
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

toplevelRun(async () => {
    await program.parseAsync();
});
