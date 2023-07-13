import { readFileSync } from "fs";
import { AgentBotRunner } from "../actors/AgentBotRunner";
import { createAgentBotConfig, AgentBotRunConfig } from "../config/BotConfig";
import { requireEnv, toplevelRun } from "../utils/helpers";
import { initWeb3 } from "../utils/web3";
import * as dotenv from "dotenv";
dotenv.config();

const OWNER_PRIVATE_KEY: string = requireEnv('OWNER_PRIVATE_KEY');
const RUN_CONFIG_PATH: string = requireEnv('RUN_CONFIG_PATH');
const RPC_URL: string = requireEnv('RPC_URL');

toplevelRun(async () => {
    const runConfig = JSON.parse(readFileSync(RUN_CONFIG_PATH).toString()) as AgentBotRunConfig;
    await initWeb3(RPC_URL, [OWNER_PRIVATE_KEY], null);
    const botConfig = await createAgentBotConfig(runConfig);
    // create runner and agents
    const runner = await AgentBotRunner.create(botConfig);
    // run
    console.log("Agent bot started, press CTRL+C to end");
    process.on('SIGINT', () => {
        runner.requestStop();
    });
    await runner.run();
    console.log("Agent bot stopped");
});