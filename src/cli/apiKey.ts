import "dotenv/config";
import "source-map-support/register";

import { Command } from "commander";
import { createSha256Hash, generateRandomHexString, toplevelRun } from "../utils/helpers";

const program = new Command();

program
    .command("create")
    .description("Create api key and its hash")
    .action(async () => {
        const apiKey = generateRandomHexString(32);
        const hash = createSha256Hash(apiKey);
        console.log(apiKey, hash);
    });

toplevelRun(async () => {
    await program.parseAsync();
});
