import { AgentBotRunner } from "./actors/AgentBotRunner";
import { BotConfig } from "./config/BotConfig";
import { createOrm } from "./config/orm";
import options from "./mikro-orm.config";
import { toplevelRun } from "./utils/helpers";

toplevelRun(async () => {
    const configFile = process.argv[2];
    const botConfig = await import(configFile).then(m => m.default) as BotConfig;
    const orm = await createOrm({ ...options, schemaUpdate: 'safe' });
    await AgentBotRunner.createAndRun(orm, botConfig);
});
