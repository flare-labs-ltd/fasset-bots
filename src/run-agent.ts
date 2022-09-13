import { PersistentAgentRunner } from "./actors/PersistentAgentRunner";
import { BotConfig } from "./config/BotConfig";
import { toplevelRun } from "./utils/helpers";

toplevelRun(async () => {
    const configFile = process.argv[2];
    const botConfig = await import(configFile).then(m => m.default) as BotConfig;
    await PersistentAgentRunner.createAndRun(botConfig);
});
