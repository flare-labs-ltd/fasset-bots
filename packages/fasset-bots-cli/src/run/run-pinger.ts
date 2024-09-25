import "dotenv/config";
import "source-map-support/register";

import { InfoBotCommands } from "@flarelabs/fasset-bots-core";
import { Secrets, createBotConfig, loadConfigFile } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3, logger, sleep } from "@flarelabs/fasset-bots-core/utils";
import { programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";


const program = programWithCommonOptions("bot", "single_fasset");
program.argument('<pingsleepsec>', 'Time to sleep between pings in milliseconds', parseInt);

program.action(async (pingSleep: number) => {
    const options: { config: string; secrets: string; fasset: string } = program.opts();
    const secrets = Secrets.load(options.secrets);
    const runConfig = loadConfigFile(options.config);
    const pingerAddress = secrets.required("pinger.address");
    const pingerPrivateKey = secrets.required("pinger.private_key");
    const infoBot = await InfoBotCommands.create(options.secrets, options.config, options.fasset);
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, secrets.optional("apiKey.native_rpc")), [pingerPrivateKey], pingerAddress);
    const config = await createBotConfig("common", secrets, runConfig, pingerAddress);
    logger.info(`Asset manager controller is ${config.contractRetriever.assetManagerController.address}.`);
    // run pinger
    while (true) {
        const agents = await infoBot.getAllAgents();
        for (const agent of agents) {
            console.log(`Pinging agent vault ${agent}...`);
            await infoBot.context.assetManager.agentPing(agent, 0, { from: pingerAddress });
            console.log(`Pinged agent vault ${agent}`);
        }
        await sleep(pingSleep);
    }
});

toplevelRun(async () => {
    await program.parseAsync();
});
