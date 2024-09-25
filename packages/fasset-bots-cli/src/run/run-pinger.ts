import "dotenv/config";
import "source-map-support/register";

import { InfoBotCommands } from "@flarelabs/fasset-bots-core";
import { BotConfig, BotFAssetConfig, Secrets, createBotConfig, loadConfigFile } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3, logger, sleep } from "@flarelabs/fasset-bots-core/utils";
import { programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";


const program = programWithCommonOptions("bot", "single_fasset");
program.argument('<pingsleepsec>', 'Time to sleep between pings in milliseconds', parseInt);

function extractFAssetFromBotConfig(config: BotConfig, fasset: string): BotFAssetConfig {
    const fassetConfig = config.fAssets.get(fasset);
    if (fassetConfig === undefined) {
        throw new Error(`FAsset ${fasset} not found in config`);
    }
    return fassetConfig;
}

program.action(async (pingSleep: number) => {
    const options: { config: string; secrets: string; fasset: string } = program.opts();
    const secrets = Secrets.load(options.secrets);
    const runConfig = loadConfigFile(options.config);
    const pingerAddress = secrets.required("pinger.address");
    const pingerPrivateKey = secrets.required("pinger.private_key");
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, secrets.optional("apiKey.native_rpc")), [pingerPrivateKey], pingerAddress);
    const config = await createBotConfig("common", secrets, runConfig, pingerAddress);
    logger.info(`Asset manager controller is ${config.contractRetriever.assetManagerController.address}.`);
    const fassetConfig = extractFAssetFromBotConfig(config, options.fasset);
    const infoBot = await InfoBotCommands.create(options.secrets, options.config, options.fasset);
    // run pinger
    while (true) {
        const agents = await infoBot.getAllAgents();
        for (const agent of agents) {
            console.log(`Pinging agent vault ${agent}...`);
            await fassetConfig.assetManager.endLiquidation(agent, { from: pingerAddress });
            console.log(`Pinged agent vault ${agent}`);
        }
        await sleep(pingSleep);
    }
});

toplevelRun(async () => {
    await program.parseAsync();
});
