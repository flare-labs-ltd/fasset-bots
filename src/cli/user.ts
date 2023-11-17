import "dotenv/config";
import "source-map-support/register";

import { Command } from "commander";
import fs from "fs";
import os from "os";
import path from "path";
import chalk from "chalk";
import { InfoBot, SecretsUser } from "../actors/InfoBot";
import { UserBot } from "../actors/UserBot";
import { resetSecrets } from "../config/secrets";
import { CommandLineError, findPackageRoot, toplevelRun } from "../utils/helpers";

const program = new Command();

program
    .addOption(
        program
            .createOption("-c, --config <configFile>", "Config file path. If not provided, environment variable FASSET_USER_CONFIG is used as path, if set. Default file is embedded in the program and usually works.")
            .env("FASSET_USER_CONFIG")
            .default(path.resolve(findPackageRoot(__dirname), "run-config/run-config-user-coston-testxrp.json"))
    )
    .addOption(
        program
            .createOption("-s, --secrets <secretsFile>", "File containing the secrets (private keys / adresses, api keys, etc.). If not provided, environment variable FASSET_USER_SECRETS is used as path, if set. Default file is <USER_HOME>/.fasset/secrets.json.")
            .env("FASSET_USER_SECRETS")
    )
    .addOption(
        program
            .createOption("-f, --fasset <fAssetSymbol>", "The symbol of the FAsset to mint, redeem or query")
    )
    .hook('preAction', (_, command) => {
        // make --fasset option mandatory always except for 'generateSecrets' command
        if (command.name() !== 'generateSecrets') {
            if (!program.getOptionValue('fasset')) {
                throw new CommandLineError("required option '-f, --fasset <fAssetSymbol>' not specified");
            }
        }
        resetSecrets(getSecretsPath());
    });

function getSecretsPath() {
    const options: { secrets?: string } = program.opts();
    const defaultSecretsPath = path.resolve(os.homedir(), 'fasset/secrets.json');
    if (options.secrets != null) {
        return options.secrets;
    } else if (fs.existsSync(defaultSecretsPath)) {
        return defaultSecretsPath;
    }
    return null;
}

program
    .command("generateSecrets")
    .description("generate new secrets file")
    .option("-o, --output <outputFile>", "the output file; if omitted, the secrets are printed to stdout")
    .option("--overwrite", "if enabled, the output file can be overwriten; otherwise it is an error if it already exists")
    .option("--agent", "also generate secrets for agent")
    .option("--other", "also generate secrets for other bots (challenger, etc.)")
    .action(async (opts: { output?: string, overwrite?: boolean, agent?: boolean, other?: boolean }) => {
        const options: { config: string, fasset?: string } = program.opts();
        const bot = await InfoBot.create(options.config, options.fasset);
        const users: SecretsUser[] = ['user'];
        if (opts.agent) users.push('agent');
        if (opts.other) users.push('other');
        const secrets = bot.generateSecrets(users);
        const json = JSON.stringify(secrets, null, 4);
        if (opts.output) {
            if (fs.existsSync(opts.output) && !opts.overwrite) {
                program.error(`error: file ${opts.output} already exists`);
            }
            fs.writeFileSync(opts.output, json);
        } else {
            console.log(json);
        }
        const emptyFields = Object.keys(secrets.apiKey).filter(k => !secrets.apiKey[k]);
        if (emptyFields.length !== 0) {
            console.error(chalk.yellow("NOTE:"),
                `Replace empty fields in apiKey (${emptyFields.join(', ')}) with api keys from your provider or delete them if not needed.`);
        }
    });

program
    .command("info")
    .description("info about the system")
    .action(async () => {
        const options: { config: string; fasset: string } = program.opts();
        const bot = await InfoBot.create(options.config, options.fasset);
        await bot.printSystemInfo();
    });

program
    .command("agents")
    .description("Lists the available agents")
    .option("-a, --all", "print all agents, including non-public")
    .action(async (opts: { all: boolean }) => {
        const options: { config: string; fasset: string } = program.opts();
        const bot = await InfoBot.create(options.config, options.fasset);
        if (opts.all) {
            await bot.printAllAgents();
        } else {
            await bot.printAvailableAgents();
        }
    });

program
    .command("agentInfo")
    .description("info about an agent")
    .argument("<agentVaultAddress>", "the address of the agent vault")
    .action(async (agentVaultAddress: string) => {
        const options: { config: string; fasset: string } = program.opts();
        const bot = await InfoBot.create(options.config, options.fasset);
        await bot.printAgentInfo(agentVaultAddress);
    });

program
    .command("mint")
    .description("Mints the amount of FAssets in lots")
    .argument("<agentVaultAddress>")
    .argument("<amountLots>")
    .option("-u, --updateBlock")
    .action(async (agentVault: string, amountLots: string, cmdOptions: { updateBlock?: boolean }) => {
        if (!getSecretsPath()) throw new CommandLineError("Missing secrets file. Perhaps you need to add argument --secret.");
        const options: { config: string; fasset: string } = program.opts();
        const minterBot = await UserBot.create(options.config, options.fasset);
        if (cmdOptions.updateBlock) {
            await minterBot.updateUnderlyingTime();
        }
        await minterBot.mint(agentVault, amountLots);
    });

program
    .command("mintExecute")
    .description("Tries to execute the minting that was paid but the execution failed")
    .argument("<requestId>")
    .action(async (requestId: string) => {
        if (!getSecretsPath()) throw new CommandLineError("Missing secrets file. Perhaps you need to add argument --secret.");
        const options: { config: string; fasset: string } = program.opts();
        const minterBot = await UserBot.create(options.config, options.fasset);
        await minterBot.proveAndExecuteSavedMinting(requestId);
    });

program
    .command("redeem")
    .description("Triggers redemption")
    .argument("<amountLots>")
    .action(async (amountLots: string) => {
        if (!getSecretsPath()) throw new CommandLineError("Missing secrets file. Perhaps you need to add argument --secret.");
        const options: { config: string; fasset: string } = program.opts();
        const redeemerBot = await UserBot.create(options.config, options.fasset);
        await redeemerBot.redeem(amountLots);
    });

program
    .command("redemptionDefault")
    .description("Get paid in collateral if the agent failed to pay redemption underlying")
    .argument("<requestId>")
    .action(async (requestId: string) => {
        if (!getSecretsPath()) throw new CommandLineError("Missing secrets file. Perhaps you need to add argument --secret.");
        const options: { config: string; fasset: string } = program.opts();
        const redeemerBot = await UserBot.create(options.config, options.fasset);
        await redeemerBot.savedRedemptionDefault(requestId);
    });

toplevelRun(async () => {
    await program.parseAsync();
});
