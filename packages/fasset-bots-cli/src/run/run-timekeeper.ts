import "dotenv/config";
import "source-map-support/register";

import { TimeKeeper } from "@flarelabs/fasset-bots-core";
import { Secrets, closeBotConfig, createBotConfig, loadConfigFile } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3 } from "@flarelabs/fasset-bots-core/utils";
import { programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";

const INTERVAL: number = 120_000; // in ms

const program = programWithCommonOptions("bot", "all_fassets");

program.action(async () => {
    const options: { config: string; secrets: string } = program.opts();
    const secrets = Secrets.load(options.secrets);
    const runConfig = loadConfigFile(options.config);
    const timekeeperAddress: string = secrets.required("timeKeeper.address");
    const timekeeperPrivateKey: string = secrets.required("timeKeeper.private_key");
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, secrets.optional("apiKey.native_rpc")), [timekeeperPrivateKey], null);
    const config = await createBotConfig(secrets, runConfig, timekeeperAddress);
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
