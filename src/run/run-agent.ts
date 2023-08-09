import { readFileSync } from "fs";
import { AgentBotRunner } from "../actors/AgentBotRunner";
import { createBotConfig, AgentBotConfigFile } from "../config/BotConfig";
import { requireEnv, toplevelRun } from "../utils/helpers";
import { initWeb3 } from "../utils/web3";
import * as dotenv from "dotenv";
dotenv.config();

const USER_ADDRESS: string = requireEnv('USER_ADDRESS');
const USER_PRIVATE_KEY: string = requireEnv('USER_PRIVATE_KEY');
const USER_UNDERLYING_ADDRESS: string = requireEnv('USER_UNDERLYING_ADDRESS');
const USER_UNDERLYING_PRIVATE_KEY: string = requireEnv('USER_UNDERLYING_PRIVATE_KEY');
const RUN_CONFIG_PATH: string = requireEnv('RUN_CONFIG_PATH');

toplevelRun(async () => {
    const runConfig = JSON.parse(readFileSync(RUN_CONFIG_PATH).toString()) as AgentBotConfigFile;
    await initWeb3(runConfig.rpcUrl, [USER_PRIVATE_KEY], null);
    const botConfig = await createBotConfig(runConfig, USER_ADDRESS);
    // create runner and agents
    const runner = await AgentBotRunner.create(botConfig);
    // store owner's underlying address
    for(const ctxMap of runner.contexts) {
        await ctxMap[1].wallet.addExistingAccount(USER_UNDERLYING_ADDRESS, USER_UNDERLYING_PRIVATE_KEY);
    }
    // run
    console.log("Agent bot started, press CTRL+C to end");
    process.on('SIGINT', () => {
        console.log("Stopping agent bot...");
        runner.requestStop();
    });
    await runner.run();
    console.log("Agent bot stopped");
});
