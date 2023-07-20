import { readFileSync } from "fs";
import { AgentBotRunner } from "../actors/AgentBotRunner";
import { createAgentBotConfig, AgentBotRunConfig } from "../config/BotConfig";
import { requireEnv, toplevelRun } from "../utils/helpers";
import { initWeb3 } from "../utils/web3";
import * as dotenv from "dotenv";
dotenv.config();

const OWNER_PRIVATE_KEY: string = requireEnv('OWNER_PRIVATE_KEY');
const OWNER_UNDERLYING_ADDRESS: string = requireEnv('OWNER_UNDERLYING_ADDRESS');
const OWNER_UNDERLYING_PRIVATE_KEY: string = requireEnv('OWNER_UNDERLYING_PRIVATE_KEY');
const RUN_CONFIG_PATH: string = requireEnv('RUN_CONFIG_PATH');

toplevelRun(async () => {
    const runConfig = JSON.parse(readFileSync(RUN_CONFIG_PATH).toString()) as AgentBotRunConfig;
    await initWeb3(runConfig.rpcUrl, [OWNER_PRIVATE_KEY], null);
    const botConfig = await createAgentBotConfig(runConfig);
    // create runner and agents
    const runner = await AgentBotRunner.create(botConfig);
    // store owner's underlying address
    for(const ctxMap of runner.contexts) {
        await ctxMap[1].wallet.addExistingAccount(OWNER_UNDERLYING_ADDRESS, OWNER_UNDERLYING_PRIVATE_KEY);
    }
    // run
    console.log("Agent bot started, press CTRL+C to end");
    process.on('SIGINT', () => {
        runner.requestStop();
    });
    await runner.run();
    console.log("Agent bot stopped");
});