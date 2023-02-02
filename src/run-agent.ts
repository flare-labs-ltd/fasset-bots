import { AgentBotRunner } from "./actors/AgentBotRunner";
import { createBotConfig, RunConfig } from "./config/BotConfig";
import { requireEnv, toplevelRun } from "./utils/helpers";
import { initWeb3 } from "./utils/web3";

const OWNER_ADDRESS: string = requireEnv('OWNER_ADDRESS');
const OWNER_PRIVATE_KEY: string = requireEnv('OWNER_PRIVATE_KEY');

toplevelRun(async () => {
    const configFile = process.argv[2];
    const runConfig = await import(configFile).then(m => m.default) as RunConfig;
    const botConfig = await createBotConfig(runConfig);
    await initWeb3(botConfig.rpcUrl, [OWNER_PRIVATE_KEY], null);
    // create runner and agents
    const runner = await AgentBotRunner.create(botConfig);
    await runner.createMissingAgents(OWNER_ADDRESS);
    // run
    console.log("Agent bot started, press CTRL+C to end");
    process.on('SIGINT', () => {
        runner.requestStop();
    });
    await runner.run();
    console.log("Agent bot stopped");
});
