import "dotenv/config";
import "source-map-support/register";

import { AgentBotCommands, AgentBotOwnerValidation, printingReporter } from "@flarelabs/fasset-bots-core";
import { Secrets, loadAgentSettings, loadConfigFile, loadContracts } from "@flarelabs/fasset-bots-core/config";
import { CommandLineError, Currencies, errorIncluded, requireNotNullCmd, squashSpace, toBIPS, toBN } from "@flarelabs/fasset-bots-core/utils";
import chalk from "chalk";
import fs from "fs";
import { programWithCommonOptions } from "../utils/program";
import { registerToplevelFinalizer, toplevelRun } from "../utils/toplevel";
import { validateAddress, validateDecimal, validateInteger } from "../utils/validation";
import BN from "bn.js";

const program = programWithCommonOptions("agent", "single_fasset");

program.name("agent-bot").description("Command line commands for AgentBot");

program
    .command("validateOwner")
    .description("validate the owner's settings and check the owner's addresses' balances")
    .action(async () => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        console.log(chalk.cyan("Initializing environment..."));
        const validator = await AgentBotOwnerValidation.create(options.secrets, options.config, printingReporter);
        console.log(chalk.cyan("Environment successfully initialized."));
        await validator.validate([options.fasset]);
        if (printingReporter.errorCount === 0) console.log("Agent owner is set up correctly.");
    });

program
    .command("create")
    .description("create new agent vault")
    .option("--prepare")
    .argument("[agentSettingsPath]")
    .action(async (agentSettingsPath: string | undefined, opts: { prepare?: string }) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        if (opts.prepare) {
            const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
            const template = await cli.prepareCreateAgentSettings();
            const fname = "tmp.agent-settings.json";
            fs.writeFileSync(fname, JSON.stringify(template, null, 4));
            console.log(`Initial settings have been written to ${fname}. Please edit this file and then execute "yarn agent-bot create ${fname}"`);
        } else if (agentSettingsPath != null && fs.existsSync(agentSettingsPath)) {
            const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
            const validator = await AgentBotOwnerValidation.fromContext(cli.context, options.secrets, options.config);
            await validator.validate([options.fasset]);
            await cli.createAgentVault(loadAgentSettings(agentSettingsPath), secrets);
        } else {
            if (agentSettingsPath != null) {
                console.error(`File ${agentSettingsPath} does not exist.`);
            } else {
                console.error(`Missing agentSettingsPath argument.`);
            }
            console.error(`First execute "yarn agent-bot create --prepare" to generate initial setting file.`);
            console.error(`Then edit that file and execute again with edited file's path as argument.`);
            process.exit(1);
        }
    });

program
    .command("depositCollaterals")
    .description("deposit enough vault and pool collateral to be able to mint given amount of lots")
    .argument("<agentVaultAddress>")
    .argument("<lots>", "the number of lots the agent should be able to mint after deposit (existing collateral in the vault is ignored)")
    .addOption(program.createOption("-m, --multiplier <multiplier>", "the number to multiply the amount with, to compensate for price changes, and account for FAssets minted as collateral pool fees.").default("1.05"))
    .action(async (agentVault: string, lots: string, cmdopts: { multiplier: string }) => {
        validateInteger(lots, "lots", { min: 1 });
        validateDecimal(cmdopts.multiplier, "multiplier", { min: 1, max: 2 });
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.depositCollateralForLots(agentVault, lots, cmdopts.multiplier);
    });

program
    .command("depositVaultCollateral")
    .description("deposit vault collateral to agent vault from owner's address")
    .argument("<agentVaultAddress>")
    .argument("<amount>")
    .action(async (agentVault: string, amount: string) => {
        validateDecimal(amount, "amount", { strictMin: 0 });
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        const currency = await Currencies.agentVaultCollateral(cli.context, agentVault);
        await cli.depositToVault(agentVault, currency.parse(amount));
    });

program
    .command("buyPoolCollateral")
    .description("add pool collateral and agent pool tokens")
    .argument("<agentVaultAddress>")
    .argument("<amount>")
    .action(async (agentVault: string, amount: string) => {
        validateDecimal(amount, "amount", { min: 1 });
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        const currency = await Currencies.agentPoolCollateral(cli.context, agentVault);
        await cli.buyCollateralPoolTokens(agentVault, currency.parse(amount));
    });

program
    .command("enter")
    .description("enter available agent's list")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.enterAvailableList(agentVault);
    });

program
    .command("exit")
    .description("begin the process of exiting from available agent's list; exit will later be executed automatically by running agent bot")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.announceExitAvailableList(agentVault);
    });

program
    .command("executeExit")
    .description("execute previously announced exit from available agent's list (only needed in special cases, since running bot does it automatically)")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.exitAvailableList(agentVault);
    });

program
    .command("info")
    .description("print agent info")
    .argument("<agentVaultAddress>")
    .option("--raw", "print direct output of getAgentInfo")
    .action(async (agentVault: string, cmdopts: { raw: boolean }) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.printAgentInfo(agentVault, cmdopts.raw);
    });

program
    .command("getAgentSettings")
    .description("print agent settings")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.printAgentSettings(agentVault);
    });

program
    .command("updateAgentSetting")
    .description("set agent's settings")
    .argument("<agentVaultAddress>")
    .argument("<agentSettingName>")
    .argument("<agentSettingValue>")
    .action(async (agentVault: string, settingName: string, settingValue: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.updateAgentSetting(agentVault, settingName, settingValue);
    });

program
    .command("underlyingTopUp")
    .description("agent underlying top up")
    .argument("<agentVaultAddress>")
    .argument("<amount>")
    .action(async (agentVault: string, amount: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        console.warn("Ensure run-agent is running to successfully top up.");
        const currency = await Currencies.fassetUnderlyingToken(cli.context);
        const amountUBA = currency.parse(amount);
        await cli.underlyingTopUp(agentVault, amountUBA);
    });

program
    .command("withdrawVaultCollateral")
    .description("begin vault collateral withdrawal process from agent's to owner’s address; withdrawal will later be executed automatically by running agent bot")
    .argument("<agentVaultAddress>")
    .argument("<amount>")
    .action(async (agentVault: string, amount: string) => {
        validateDecimal(amount, "amount", { strictMin: 0 });
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        const currency = await Currencies.agentVaultCollateral(cli.context, agentVault);
        await cli.announceWithdrawFromVault(agentVault, currency.parse(amount));
    });

program
    .command("cancelVaultCollateralWithdrawal")
    .description("cancel vault collateral withdrawal process")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.cancelWithdrawFromVaultAnnouncement(agentVault);
    });

program
    .command("redeemCollateralPoolTokens")
    .description("begin collateral pool tokens redemption process from agent's to owner’s address; redemption will later be executed automatically by running agent bot")
    .argument("<agentVaultAddress>")
    .argument("<amount>")
    .action(async (agentVault: string, amount: string) => {
        validateDecimal(amount, "amount", { strictMin: 0 });
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        const currency = await Currencies.agentPoolCollateral(cli.context, agentVault);
        await cli.announceRedeemCollateralPoolTokens(agentVault, currency.parse(amount));
    });

program
    .command("cancelCollateralPoolTokenRedemption")
    .description("cancel collateral pool tokens redemption process")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.cancelCollateralPoolTokenRedemption(agentVault);
    });

program
    .command("withdrawPoolFees")
    .description("withdraw pool fees from pool to owner's address")
    .argument("<agentVaultAddress>")
    .argument("[amount]", "amount of fassets, default is withdraw all fees")
    .action(async (agentVault: string, amount?: string) => {
        validateDecimal(amount, "amount", { strictMin: 0 });
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        let amountUBA: BN;
        if (amount) {
            const currency = await Currencies.fasset(cli.context);
            amountUBA = currency.parse(amount);
        } else {
            const { agentBot } = await cli.getAgentBot(agentVault);
            amountUBA = await agentBot.agent.poolFeeBalance();
        }
        await cli.withdrawPoolFees(agentVault, amountUBA);
    });

program
    .command("poolFeesBalance")
    .description("get pool fees balance of agent")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.poolFeesBalance(agentVault);
    });

program
    .command("selfClose")
    .description("self close agent vault with amount of FAssets")
    .argument("<agentVaultAddress>")
    .argument("<amount>")
    .action(async (agentVault: string, amount: string) => {
        validateDecimal(amount, "amount", { strictMin: 0 });
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        const currency = await Currencies.fasset(cli.context);
        await cli.selfClose(agentVault, currency.parse(amount));
    });

program
    .command("close")
    .description("begin the process of closing agent vault; all the steps required will later be performed automatically by running agent bot")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.closeVault(agentVault);
    });

program
    .command("withdrawUnderlying")
    .description("announce and perform underlying withdrawal and get transaction hash; a part of the amount will be deducted for the fee")
    .argument("<agentVaultAddress>")
    .argument("<amount>")
    .argument("<destinationAddress>")
    .action(async (agentVault: string, amount: string, destinationAddress: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        const destinationAddressTrimmed = destinationAddress.trim();
        const currency = await Currencies.fassetUnderlyingToken(cli.context);
        await cli.withdrawUnderlying(agentVault, currency.parse(amount), destinationAddressTrimmed);
    });

program
    .command("cancelUnderlyingWithdrawal")
    .description("cancel underlying withdrawal announcement")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.cancelUnderlyingWithdrawal(agentVault);
    });

program
    .command("listAgents")
    .description("list active agent from persistent state")
    .action(async () => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.listActiveAgents(options.fasset);
    });

program
    .command("delegatePoolCollateral")
    .description("delegate pool collateral, where <share> is decimal number (e.g. 0.3) or percentage (e.g. 30%)")
    .argument("<agentVaultAddress>")
    .argument("<recipient>")
    .argument("<share>", "vote power share as decimal number (e.g. 0.3) or percentage (e.g. 30%)")
    .action(async (agentVault: string, recipient: string, share: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.delegatePoolCollateral(agentVault, recipient, toBIPS(share));
    });

program
    .command("undelegatePoolCollateral")
    .description("undelegate pool collateral")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.undelegatePoolCollateral(agentVault);
    });

program
    .command("createUnderlyingAccount")
    .description("create underlying account")
    .action(async () => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        const { address, privateKey } = await cli.createUnderlyingAccount(secrets);
        console.log({ address, privateKey });
    });

program
    .command("freeVaultCollateral")
    .description("get free vault collateral")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        const freeCollateral = await cli.getFreeVaultCollateral(agentVault);
        const currency = await Currencies.agentVaultCollateral(cli.context, agentVault);
        console.log(`Agent ${agentVault} has ${currency.format(freeCollateral)} free vault collateral.`);
    });

program
    .command("freePoolCollateral")
    .description("get free pool collateral")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        const freeCollateral = await cli.getFreePoolCollateral(agentVault);
        const currency = await Currencies.agentPoolCollateral(cli.context, agentVault);
        console.log(`Agent ${agentVault} has ${currency.format(freeCollateral)} free pool collateral.`);
    });

program
    .command("freeUnderlying")
    .description("get free underlying balance")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        const freeUnderlying = await cli.getFreeUnderlying(agentVault);
        const safeToWithdrawUnderlying = await cli.getSafeToWithdrawUnderlying(agentVault);
        const currency = await Currencies.fasset(cli.context);
        console.log(`Agent ${agentVault} has ${currency.format(freeUnderlying)} free underlying.`);
        console.log(`It is safe to withdraw up to ${currency.format(safeToWithdrawUnderlying)}.`);
    });

program
    .command("switchVaultCollateral")
    .description("switch vault collateral")
    .argument("<agentVaultAddress>")
    .argument("<token>", "token name or address")
    .option("--deposit", "automatically deposit the amount of new tokens, equivalent to the amount of old tokens in the vault")
    .action(async (agentVault: string, token: string, cmdOptions: { deposit?: boolean }) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        token = getContractByName(options.config, token);
        if (cmdOptions.deposit) {
            await cli.depositAndSwitchVaultCollateral(agentVault, token);
        } else {
            await cli.switchVaultCollateral(agentVault, token);
        }
    });

function getContractByName(config: string, nameOrAddress: string) {
    if (nameOrAddress.startsWith("0x")) {
        return nameOrAddress;
    }
    const configFile = loadConfigFile(config);
    const contracts = loadContracts(requireNotNullCmd(configFile.contractsJsonFile, "Contracts are required to get contract by name"));
    const contract = requireNotNullCmd(contracts[nameOrAddress], `Missing contract ${nameOrAddress}`);
    return contract.address;
}

program
    .command("upgradeWNat")
    .description("upgrade WNat contract")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.upgradeWNatContract(agentVault);
    });

program
    .command("exportPrivateKeys")
    .description("export underlying agent vault private keys")
    .argument("<exportFile>")
    .action(async (exportFile: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        const data = await cli.getOwnedEncryptedUnderlyingAccounts();
        fs.writeFileSync(exportFile, JSON.stringify(data, null, 4));
    })

program
    .command("selfMint")
    .description("agent mints against himself - agent does not have to be publicly available")
    .argument("<agentVaultAddress>")
    .argument("<numberOfLots>")
    .action(async (agentVault: string, numberOfLots: string) => {
        validateAddress(agentVault, "Agent vault address");
        validateInteger(numberOfLots, "Number of lots", { min: 1 });
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.selfMint(agentVault, toBN(numberOfLots));
        console.warn("Ensure run-agent is running to successfully finish self mint.");
    });

program
    .command("selfMintFromFreeUnderlying")
    .alias("mintFromFreeUnderlying")
    .description("agent mints against himself from free underlying - agent does not have to be publicly available")
    .argument("<agentVaultAddress>")
    .argument("<numberOfLots>")
    .action(async (agentVault: string, numberOfLots: string) => {
        validateAddress(agentVault, "Agent vault address");
        validateInteger(numberOfLots, "Number of lots", { min: 1 });
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.selfMintFromFreeUnderlying(agentVault, toBN(numberOfLots));
        console.log(`Agent ${agentVault} minted ${numberOfLots} lots from free underlying.`);
    });

program
    .command("balances")
    .alias("balance")
    .description("Print owner balances for relevant tokens")
    .option("-w, --work", "Print only balances for work account")
    .option("-m, --management", "Print only balances for management account")
    .action(async (cmdOptions: { management: boolean, work: boolean }) => {
        const options: { config: string; secrets: string; fasset: string; dir: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const bot = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        const both = !cmdOptions.work && !cmdOptions.management;
        if (cmdOptions.work || both) {
            console.log(chalk.yellowBright("WORK ACCOUNT:"));
            await bot.infoBot().printBalances(bot.owner.workAddress, bot.ownerUnderlyingAddress);
        }
        if (cmdOptions.management || both) {
            console.log(chalk.yellowBright("MANAGEMENT ACCOUNT:"));
            await bot.infoBot().printBalances(bot.owner.managementAddress);
        }
    });

program
    .command("transferToCoreVault")
    .description("agent requests transfers of its underlying to core vault")
    .argument("<agentVaultAddress>")
    .argument("<amount>")
    .action(async (agentVault: string, amount: string) => {
        validateAddress(agentVault, "Agent vault address");
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        const currency = await Currencies.fassetUnderlyingToken(cli.context);
        await cli.transferToCoreVault(agentVault, currency.parse(amount));
    });

program
    .command("maximumTransferToCoreVault")
    .description("get maximum amount to transfer to core vault and minimum amount to be left on underlying")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        validateAddress(agentVault, "Agent vault address");
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        const allowed = await cli.getMaximumTransferToCoreVault(agentVault);
        const currency = await Currencies.fasset(cli.context);
        console.log(`Agent's ${agentVault} maximum amount to transfer is ${currency.format(allowed.maximumTransferUBA)}.`);
        console.log(`Agent's ${agentVault} minimum amount to be left is ${currency.format(allowed.minimumLeftAmountUBA)}.`);
    });

program
    .command("returnFromCoreVault")
    .description("agent requests underlying transfer from core vault")
    .argument("<agentVaultAddress>")
    .argument("<lots>")
    .action(async (agentVault: string, lots: string) => {
        validateAddress(agentVault, "Agent vault address");
        validateInteger(lots, "lots", { min: 1 });
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.returnFromCoreVault(agentVault, lots);
    });

program
    .command("cancelReturnFromCoreVault")
    .description("cancellation of agent's return from core vault")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        validateAddress(agentVault, "Agent vault address");
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const cli = await AgentBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.cancelReturnFromCoreVault(agentVault);
    });

toplevelRun(async () => {
    try {
        await program.parseAsync();
    } catch (error: any) {
        if (errorIncluded(error, ["invalid agent vault address", "AgentEntity not found"])) {
            const fAsset = program.opts().fasset;
            throw new CommandLineError(squashSpace`Invalid agent vault address: specified agent vault address has to be one of the agent vaults created by you.
                To see them run \`yarn agent-bot listAgents -f ${fAsset}\`.`);
        }
        throw error;
    }
});
