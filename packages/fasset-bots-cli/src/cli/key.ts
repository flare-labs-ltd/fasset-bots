import "dotenv/config";
import "source-map-support/register";

import { Command } from "commander";
import { createSha256Hash, generateRandomHexString, toplevelRun } from "@flarelabs/fasset-bots-core/utils";

const program = new Command();

program
    .command("createApiKeyAndHash")
    .description("create api key and its hash")
    .action(async () => {
        const apiKey = generateRandomHexString(32);
        const hash = createSha256Hash(apiKey);
        console.log(apiKey, hash);
    });

program
    .command("createWalletEncryptionPassword")
    .description("create wallet encryption password")
    .action(async () => {
        const password = generateRandomHexString(32);
        console.log(password);
    });

toplevelRun(async () => {
    await program.parseAsync();
});
