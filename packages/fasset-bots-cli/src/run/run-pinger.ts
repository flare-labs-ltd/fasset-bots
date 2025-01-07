import "dotenv/config";
import "source-map-support/register";

import { InfoBotCommands } from "@flarelabs/fasset-bots-core";
import { Secrets, createBotConfig, loadConfigFile } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3, logger, sleep } from "@flarelabs/fasset-bots-core/utils";
import { getOneDefaultToAll, programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";


const program = programWithCommonOptions("bot", "all_fassets");
program.argument('<pingsleepsec>', 'Time to sleep between pings in milliseconds', parseInt);

async function pingFAssetAgents(infoBot: InfoBotCommands, pingerAddress: string) {
    const agents = await infoBot.getAllAgents();
    for (const agent of agents) {
        console.log(`Pinging ${infoBot.context.fAssetSymbol} agent vault ${agent}...`);
        await infoBot.context.assetManager.agentPing(agent, 0, { from: pingerAddress });
        console.log(`Pinged ${infoBot.context.fAssetSymbol} agent vault ${agent}`);
    }
}

program.action(async (pingSleep: number) => {
    const options: { config: string; secrets: string; fasset: string } = program.opts();
    const secrets = await Secrets.load(options.secrets);
    const runConfig = loadConfigFile(options.config);
    const pingerAddress = secrets.required("pinger.address");
    const pingerPrivateKey = secrets.required("pinger.private_key");
    const rpcApiKey = secrets.optional("apiKey.native_rpc")
    const accounts = await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, rpcApiKey), [pingerPrivateKey], pingerAddress);
    const config = await createBotConfig("common", secrets, runConfig, pingerAddress);
    const fassetList = getOneDefaultToAll(config.fAssets, options.fasset);
    const infoBots = await Promise.all(fassetList.map(f => InfoBotCommands.create(secrets, options.config, f.fAssetSymbol, undefined, accounts)));
    logger.info(`Asset manager controller is ${config.contractRetriever.assetManagerController.address}.`);
    // has to come after info bots are created, otherwise the web3 instance is overwritten
    while (true) {
        for (let i = 0; i < fassetList.length; i++) {
            const infoBot = infoBots[i];
            await pingFAssetAgents(infoBot, pingerAddress);
        }
        await sleep(pingSleep);
    }
});

toplevelRun(async () => {
    await program.parseAsync();
});
