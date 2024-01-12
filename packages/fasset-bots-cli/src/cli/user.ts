import "dotenv/config";
import "source-map-support/register";

import chalk from "chalk";
import { Command } from "commander";
import { InfoBot, SecretsUser, UserBot } from "@flarelabs/fasset-bots-core";
import { requireSecret, resetSecrets } from "@flarelabs/fasset-bots-core/config";
import { CommandLineError, ZERO_ADDRESS, minBN, resolveInFassetBotsCore, toBN, toBNExp, toplevelRun } from "@flarelabs/fasset-bots-core/utils";
import fs from "fs";
import os from "os";
import path from "path";
import Web3 from "web3";

const program = new Command();

program
    .addOption(
        program
            .createOption(
                "-c, --config <configFile>",
                "Config file path. If not provided, environment variable FASSET_USER_CONFIG is used as path, if set. Default file is embedded in the program and usually works."
            )
            .env("FASSET_USER_CONFIG")
            .default(resolveInFassetBotsCore("run-config/coston-user.json"))
    )
    .addOption(
        program
            .createOption(
                "-s, --secrets <secretsFile>",
                "File containing the secrets (private keys / adresses, api keys, etc.). If not provided, environment variable FASSET_USER_SECRETS is used as path, if set. Default file is <USER_HOME>/.fasset/secrets.json."
            )
            .env("FASSET_USER_SECRETS")
    )
    .addOption(program.createOption("-f, --fasset <fAssetSymbol>", "The symbol of the FAsset to mint, redeem or query"))
    .hook("preAction", (_, command) => {
        // make --fasset option mandatory always except for 'generateSecrets' command
        if (command.name() !== "generateSecrets") {
            if (!program.getOptionValue("fasset")) {
                throw new CommandLineError("required option '-f, --fasset <fAssetSymbol>' not specified");
            }
        }
        resetSecrets(getSecretsPath());
    });

function getSecretsPath() {
    const options: { secrets?: string } = program.opts();
    const defaultSecretsPath = path.resolve(os.homedir(), "fasset/secrets.json");
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
    .action(async (opts: { output?: string; overwrite?: boolean; agent?: boolean; other?: boolean }) => {
        const options: { config: string; fasset?: string } = program.opts();
        const bot = await InfoBot.create(options.config, options.fasset);
        const users: SecretsUser[] = ["user"];
        if (opts.agent) users.push("agent");
        if (opts.other) users.push("other");
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
        const emptyFields = Object.keys(secrets.apiKey).filter((k) => !secrets.apiKey[k]);
        if (emptyFields.length !== 0) {
            console.error(
                chalk.yellow("NOTE:"),
                `Replace empty fields in apiKey (${emptyFields.join(", ")}) with api keys from your provider or delete them if not needed.`
            );
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
    .option("-a --agent <agentVaultAddress>", "agent to use for minting; if omitted, use the one with least fee that can mint required number of lots")
    .argument("<amountLots>")
    .option("-u, --updateBlock")
    .option("--executor <executorAddress>", "optional executor's native address")
    .option("--executorFee <executorFee>", "optional executor's fee in nat wei")
    .action(async (amountLots: string, cmdOptions: { agent?: string; updateBlock?: boolean, executor?: string, executorFee?: string }) => {
        if (!getSecretsPath()) throw new CommandLineError("Missing secrets file. Perhaps you need to add argument --secrets.");
        const options: { config: string; fasset: string } = program.opts();
        const minterBot = await UserBot.create(options.config, options.fasset, true);
        const agentVault = cmdOptions.agent ?? (await minterBot.infoBot().findBestAgent(toBN(amountLots)));
        if (agentVault == null) {
            throw new CommandLineError("No agent with enough free lots available");
        }
        if (cmdOptions.updateBlock) {
            await minterBot.updateUnderlyingTime();
        }
        if (cmdOptions.executor && !cmdOptions.executorFee) {
            throw new CommandLineError("Missing executorFee");
        }
        if (!cmdOptions.executor && cmdOptions.executorFee) {
            throw new CommandLineError("Missing executor address");
        }
        if (cmdOptions.executor && cmdOptions.executorFee) {
            await minterBot.mint(agentVault, amountLots, cmdOptions.executor, cmdOptions.executorFee);
        } else {
            await minterBot.mint(agentVault, amountLots);
        }
    });

program
    .command("mintExecute")
    .description("Tries to execute the minting that was paid but the execution failed")
    .argument("<requestId>", "request id (number) or path to json file with minting data (for executors)")
    .action(async (requestId: string) => {
        if (!getSecretsPath()) throw new CommandLineError("Missing secrets file. Perhaps you need to add argument --secrets.");
        const options: { config: string; fasset: string } = program.opts();
        const minterBot = await UserBot.create(options.config, options.fasset, true);
        await minterBot.proveAndExecuteSavedMinting(requestId);
    });

program
    .command("mintStatus")
    .description("List all open mintings")
    .action(async () => {
        if (!getSecretsPath()) throw new CommandLineError("Missing secrets file. Perhaps you need to add argument --secrets.");
        const options: { config: string; fasset: string } = program.opts();
        const minterBot = await UserBot.create(options.config, options.fasset, false);
        await minterBot.listMintings();
    });

program
    .command("redeem")
    .description("Triggers redemption")
    .argument("<amountLots>")
    .option("--executor <executorAddress>", "optional executor's native address")
    .option("--executorFee <executorFee>", "optional executor's fee in nat wei")
    .action(async (amountLots: string, cmdOptions: { executorAddress?: string, executorFee?: string }) => {
        if (!getSecretsPath()) throw new CommandLineError("Missing secrets file. Perhaps you need to add argument --secrets.");
        const options: { config: string; fasset: string } = program.opts();
        const redeemerBot = await UserBot.create(options.config, options.fasset, true);
        if (cmdOptions.executorAddress && !cmdOptions.executorFee) {
            throw new CommandLineError("Missing executorFee");
        }
        if (!cmdOptions.executorAddress && cmdOptions.executorFee) {
            throw new CommandLineError("Missing executorAddress");
        }
        if (cmdOptions.executorAddress && cmdOptions.executorFee) {
            await redeemerBot.redeem(amountLots, cmdOptions.executorAddress, cmdOptions.executorFee)
        } else {
            await redeemerBot.redeem(amountLots);
        }
    });

program
    .command("redemptionDefault")
    .description("Get paid in collateral if the agent failed to pay redemption underlying")
    .argument("<requestId>", "request id (number) or path to json file with minting data (for executors)")
    .action(async (requestId: string) => {
        if (!getSecretsPath()) throw new CommandLineError("Missing secrets file. Perhaps you need to add argument --secrets.");
        const options: { config: string; fasset: string } = program.opts();
        const redeemerBot = await UserBot.create(options.config, options.fasset, true);
        await redeemerBot.savedRedemptionDefault(requestId);
    });

program
    .command("redemptionStatus")
    .description("List all open redemptions")
    .action(async () => {
        if (!getSecretsPath()) throw new CommandLineError("Missing secrets file. Perhaps you need to add argument --secrets.");
        const options: { config: string; fasset: string } = program.opts();
        const redeemerBot = await UserBot.create(options.config, options.fasset, true);
        await redeemerBot.listRedemptions();
    });

program
    .command("pools")
    .description("Print the list of pools of public agents")
    .action(async () => {
        const options: { config: string; fasset: string } = program.opts();
        const bot = await InfoBot.create(options.config, options.fasset);
        await bot.printPools();
    });

program
    .command("poolHoldings")
    .description("Print the amount of tokens the user owns per pool")
    .action(async () => {
        if (!getSecretsPath()) throw new CommandLineError("Missing secrets file. Perhaps you need to add argument --secrets.");
        const options: { config: string; fasset: string } = program.opts();
        const bot = await InfoBot.create(options.config, options.fasset);
        const address = requireSecret("user.native.address");
        await bot.printPoolTokenBalance(address);
    });

program
    .command("enterPool")
    .description("Enter a collateral pool with specified amount of collateral")
    .argument("<poolAddressOrTokenSymbol>")
    .argument("<collateralAmount>")
    .action(async (poolAddressOrTokenSymbol: string, collateralAmount: string) => {
        if (!getSecretsPath()) throw new CommandLineError("Missing secrets file. Perhaps you need to add argument --secrets.");
        const options: { config: string; fasset: string } = program.opts();
        const bot = await UserBot.create(options.config, options.fasset, false);
        const poolAddress = await getPoolAddress(bot, poolAddressOrTokenSymbol);
        const collateralAmountWei = toBNExp(collateralAmount, 18);
        const entered = await bot.enterPool(poolAddress, collateralAmountWei);
        const tokens = Number(entered.receivedTokensWei) / 1e18;
        console.log(`Received ${tokens.toFixed(2)} collateral pool tokens`);
    });

program
    .command("exitPool")
    .description("Exit a collateral pool for specified amount or all pool tokens")
    .argument("<poolAddressOrTokenSymbol>")
    .argument("<amount>", 'the amount of tokens to burn, can be a number or "all"')
    .action(async (poolAddressOrTokenSymbol: string, tokenAmountOrAll: string) => {
        if (!getSecretsPath()) throw new CommandLineError("Missing secrets file. Perhaps you need to add argument --secrets.");
        const options: { config: string; fasset: string } = program.opts();
        const bot = await UserBot.create(options.config, options.fasset, false);
        const poolAddress = await getPoolAddress(bot, poolAddressOrTokenSymbol);
        const balance = await bot.infoBot().getPoolTokenBalance(poolAddress, bot.nativeAddress);
        const tokenAmountWei = tokenAmountOrAll === "all" ? balance : minBN(toBNExp(tokenAmountOrAll, 18), balance);
        const exited = await bot.exitPool(poolAddress, tokenAmountWei);
        const burned = Number(exited.burnedTokensWei) / 1e18;
        const collateral = Number(exited.receivedNatWei) / 1e18;
        const fassets = Number(exited.receviedFAssetFeesUBA) / 10 ** Number(await bot.context.fAsset.decimals());
        const fassetSymbol = await bot.context.fAsset.symbol();
        console.log(`Burned ${burned.toFixed(2)} pool tokens.`);
        console.log(`Received ${collateral.toFixed(2)} CFLR collateral and ${fassets.toFixed(2)} ${fassetSymbol} fasset fees.`);
    });

async function getPoolAddress(bot: UserBot, poolAddressOrTokenSymbol: string) {
    return Web3.utils.isAddress(poolAddressOrTokenSymbol) ? poolAddressOrTokenSymbol : await bot.infoBot().findPoolBySymbol(poolAddressOrTokenSymbol);
}

toplevelRun(async () => {
    await program.parseAsync();
});
