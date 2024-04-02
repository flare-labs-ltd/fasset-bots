import "dotenv/config";
import "source-map-support/register";

import { TimeKeeper } from "@flarelabs/fasset-bots-core";
import { closeBotConfig, createBotConfig, getSecrets, loadConfigFile, requireSecret } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3 } from "@flarelabs/fasset-bots-core/utils";
import { programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";

const INTERVAL: number = 120_000; // in ms

const program = programWithCommonOptions("bot", "all_fassets");

program.action(async () => {
    const options: { config: string } = program.opts();
    const runConfig = loadConfigFile(options.config);
    const timekeeperAddress: string = requireSecret("timeKeeper.address");
    const timekeeperPrivateKey: string = requireSecret("timeKeeper.private_key");
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), [timekeeperPrivateKey], null);
    const config = await createBotConfig(runConfig, timekeeperAddress);
    const timekeepers = await TimeKeeper.startTimekeepers(config, timekeeperAddress, INTERVAL);
    // run
    try {
        console.log("Timekeeper bot started, press CTRL+C to end");
        await new Promise<void>((resolve) => {
            process.on("SIGINT", () => {
                console.log("Timekeeper bot stopping...");
                resolve();
            });
        });
    } finally {
        await TimeKeeper.stopTimekeepers(timekeepers);
        await closeBotConfig(config);
    }
    console.log("Timekeeper bot stopped");
});

toplevelRun(async () => {
    await program.parseAsync();
});
