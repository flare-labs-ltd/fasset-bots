import { AgentBotRunner } from "./actors/AgentBotRunner";
import { BotConfig } from "./config/BotConfig";
import { createOrm } from "./config/orm";
import options from "./mikro-orm.config";
import { requireEnv, toplevelRun } from "./utils/helpers";
import { initWeb3 } from "./utils/web3";

const OWNER_ADDRESS = requireEnv('OWNER_ADDRESS');
const OWNER_PRIVATE_KEY = requireEnv('OWNER_PRIVATE_KEY');

toplevelRun(async () => {
    const configFile = process.argv[2];
    const botConfig = await import(configFile).then(m => m.default) as BotConfig;
    const orm = await createOrm({ ...options, schemaUpdate: 'safe' });
    await initWeb3(botConfig.rpcUrl, [OWNER_PRIVATE_KEY], null);
    // create runner and agents
    const runner = await AgentBotRunner.create(orm, botConfig);
    await runner.createMissingAgents(OWNER_ADDRESS);
    // run
    console.log("Agent bot started, press CTRL+C to end");
    process.on('SIGINT', () => {
        runner.requestStop();
    });
    await runner.run();
    console.log("Agent bot stopped");
});
