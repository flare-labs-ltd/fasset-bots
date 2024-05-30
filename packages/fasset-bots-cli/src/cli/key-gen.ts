import "dotenv/config";
import "source-map-support/register";

import { SecretsUser, generateSecrets, generateUnderlyingAccount } from "@flarelabs/fasset-bots-core";
import { createSha256Hash, generateRandomHexString, logger, squashSpace } from "@flarelabs/fasset-bots-core/utils";
import chalk from "chalk";
import { Command } from "commander";
import fs from "fs";
import path from "path";
import { expandConfigPath } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";

const program = new Command();

program.name("key-gen").description("Command line commands for generating keys and secrets file");

program
    .command("generateSecrets")
    .description("generate new secrets file")
    .option("-c, --config <configFile>", "Config file path. If omitted, env var FASSET_BOT_CONFIG or FASSET_USER_CONFIG is used. If this is undefined, use embedded config.")
    .option("-o, --output <outputFile>", "the output file; if omitted, the secrets are printed to stdout")
    .option("--overwrite", "if enabled, the output file can be overwriten; otherwise it is an error if it already exists")
    .option("--user", "generate secrets for user")
    .option("--agent <managementAddress>", "generate secrets for agent; required argument is agent owner's management (cold) address")
    .option("--other", "generate secrets for other bots (challenger, etc.)")
    .action(async (opts: { config?: string; output?: string; overwrite?: boolean; user?: boolean; agent?: string; other?: boolean }) => {
        const users: SecretsUser[] = [];
        if (opts.user) users.push("user");
        if (opts.agent) users.push("agent");
        if (opts.other) users.push("other");
        if (!opts.config) {
            opts.config = process.env.FASSET_BOT_CONFIG ?? process.env.FASSET_USER_CONFIG ?? "coston";
        }
        opts.config = expandConfigPath(opts.config, "bot");
        const secrets = generateSecrets(opts.config, users, opts.agent);
        const json = JSON.stringify(secrets, null, 4);
        if (opts.output) {
            if (fs.existsSync(opts.output) && !opts.overwrite) {
                program.error(`error: file ${opts.output} already exists`);
            }
            if (!fs.existsSync(path.dirname(opts.output))) {
                fs.mkdirSync(path.dirname(opts.output));
            }
            fs.writeFileSync(opts.output, json);
            if (process.platform !== "win32") {
                try {
                    fs.chmodSync(opts.output, 0o600);
                } catch (error) {
                    logger.error(`Error changing mode for file ${opts.output}`, error);
                    console.error(`${chalk.yellow("WARNING:")} You must set file permissions to 600 by executing "chmod 600 ${opts.output}"`);
                }
            } else if (process.env.ALLOW_SECRETS_ON_WINDOWS !== "true") {
                console.error(`${chalk.yellow("WARNING:")} You must set environment variable ALLOW_SECRETS_ON_WINDOWS=true to use secrets on windows`);
            }
        } else {
            console.log(json);
        }
        const emptyFields = Object.keys(secrets.apiKey).filter((k) => !secrets.apiKey[k]);
        if (emptyFields.length !== 0) {
            console.error(
                chalk.yellow("NOTE:"),
                `Replace empty fields in apiKey (${emptyFields.join(", ")}) with api keys from your provider or delete them if not needed.`
            );
        }
        if (secrets.owner) {
            const workAddress = secrets.owner.native.address;
            console.error(squashSpace`${chalk.yellow("NOTE:")} New agent's work address ${workAddress} has been created.
                To use it, first make sure your management address has been whitelisted, and then
                execute ${chalk.green(`AgentOwnerRegistry.setWorkAddress(${workAddress})`)} on block explorer.`);
            console.error(squashSpace`${chalk.yellow("WARNING:")} Be careful - there can be only one work address per management address,
                so make sure you don't owerwrite it.`);
        }
    });

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

program
    .command("createAccount")
    .description("create new addres/private key pair on the underlying chain")
    .argument("<chainName>", "chain name, e.g. XRP or testXRP")
    .action(async (chainName: string) => {
        const account = generateUnderlyingAccount(chainName);
        console.log("Address:", account.address);
        console.log("Private key:", account.privateKey);
    });

toplevelRun(async () => {
    await program.parseAsync();
});
