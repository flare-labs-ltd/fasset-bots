import "dotenv/config";
import "source-map-support/register";

import { ActorBaseKind, ActorBaseRunner } from "@flarelabs/fasset-bots-core";
import { createBotConfig, getSecrets, loadConfigFile, requireSecret } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3, toplevelRun } from "@flarelabs/fasset-bots-core/utils";
import { programWithCommonOptions } from "../utils/program";

const program = programWithCommonOptions("bot", "all_fassets");

program.action(async () => {
    const options: { config: string } = program.opts();
    const runConfig = loadConfigFile(options.config);
    const systemKeeperAddress: string = requireSecret("systemKeeper.address");
    const systemKeeperPrivateKey: string = requireSecret("systemKeeper.private_key");
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), [systemKeeperPrivateKey], null);
    const config = await createBotConfig(runConfig, systemKeeperAddress);
    const runners = await Promise.all(config.fAssets.map(
        (chainConfig) => ActorBaseRunner.create(config, systemKeeperAddress, ActorBaseKind.SYSTEM_KEEPER, chainConfig)
    ));
    // run
    console.log("System keeper bot started, press CTRL+C to end");
    process.on("SIGINT", () => {
        console.log("System keeper bot stopping...");
        runners.forEach(runner => runner.requestStop());
    });
    await Promise.allSettled(runners.map(
        runner => runner.run(ActorBaseKind.SYSTEM_KEEPER))
    );
    console.log("System keeper bot stopped");
});

toplevelRun(async () => {
    await program.parseAsync();
});
