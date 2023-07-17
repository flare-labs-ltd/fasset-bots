#!/usr/bin/env ts-node
import { toplevelRun } from "../utils/helpers";
import { BotCliCommands } from "./BotCliCommands";

toplevelRun(async () => {
    const cli = new BotCliCommands();
    await cli.initEnvironment();
    await cli.run(process.argv);
});

