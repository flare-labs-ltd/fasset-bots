import "dotenv/config";
import "source-map-support/register";

import { TimeKeeperService, TimekeeperTimingConfig } from "@flarelabs/fasset-bots-core";
import { Secrets, closeBotConfig, createBotConfig, loadConfigFile } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3 } from "@flarelabs/fasset-bots-core/utils";
import { programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";

const timekeeperConfig: TimekeeperTimingConfig = {
    queryWindow: 7200,
    updateIntervalMs: 120_000,
    loopDelayMs: 2000,
    maxUnderlyingTimestampAgeS: 1,
    maxUpdateTimeDelayMs: 0,
}

const program = programWithCommonOptions("bot", "all_fassets");

program.action(async () => {
    const options: { config: string; secrets: string } = program.opts();
    const secrets = Secrets.load(options.secrets);
    const runConfig = loadConfigFile(options.config);
    const timekeeperAddress: string = secrets.required("timeKeeper.address");
    const timekeeperPrivateKey: string = secrets.required("timeKeeper.private_key");
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, secrets.optional("apiKey.native_rpc")), [timekeeperPrivateKey], null);
    const config = await createBotConfig("keeper", secrets, runConfig, timekeeperAddress);
    const timekeeperService = await TimeKeeperService.create(config, timekeeperAddress, timekeeperConfig);
    timekeeperService.startAll();
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
        await timekeeperService.stopAll();
        await closeBotConfig(config);
    }
    console.log("Timekeeper bot stopped");
});

toplevelRun(async () => {
    await program.parseAsync();
});
