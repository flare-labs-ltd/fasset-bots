import "dotenv/config";
import "source-map-support/register";

import { AgentBotCommands, AgentBotOwnerValidation, printingReporter } from "@flarelabs/fasset-bots-core";
import { Secrets, loadAgentSettings } from "@flarelabs/fasset-bots-core/config";
import { CommandLineError, Currencies, errorIncluded, squashSpace, toBIPS } from "@flarelabs/fasset-bots-core/utils";
import chalk from "chalk";
import fs from "fs";
import { programWithCommonOptions } from "../utils/program";
import { registerToplevelFinalizer, toplevelRun } from "../utils/toplevel";
import { validateDecimal, validateInteger } from "../utils/validation";

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
        if (opts.prepare) {
            const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
            const template = await cli.prepareCreateAgentSettings();
            const fname = "tmp.agent-settings.json";
            fs.writeFileSync(fname, JSON.stringify(template, null, 4));
            console.log(`Initial settings have been written to ${fname}. Please edit this file and then execute "yarn agent-bot create ${fname}"`);
        } else if (agentSettingsPath != null && fs.existsSync(agentSettingsPath)) {
            const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
            const validator = await AgentBotOwnerValidation.fromContext(cli.context, options.secrets, options.config);
            await validator.validate([options.fasset]);
            await cli.createAgentVault(loadAgentSettings(agentSettingsPath));
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
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
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
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
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
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        const currency = await Currencies.agentPoolCollateral(cli.context, agentVault);
        await cli.buyCollateralPoolTokens(agentVault, currency.parse(amount));
    });

program
    .command("enter")
    .description("enter available agent's list")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.enterAvailableList(agentVault);
    });

program
    .command("exit")
    .description("begin the process of exiting from available agent's list; exit will later be executed automatically by running agent bot")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.announceExitAvailableList(agentVault);
    });

program
    .command("executeExit")
    .description("execute previously announced exit from available agent's list (only needed in special cases, since running bot does it automatically)")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.exitAvailableList(agentVault);
    });

program
    .command("info")
    .description("print agent info")
    .argument("<agentVaultAddress>")
    .option("--raw", "print direct output of getAgentInfo")
    .action(async (agentVault: string, cmdopts: { raw: boolean }) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.printAgentInfo(agentVault, cmdopts.raw);
    });

program
    .command("getAgentSettings")
    .description("print agent settings")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
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
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.updateAgentSetting(agentVault, settingName, settingValue);
    });

program
    .command("withdrawVaultCollateral")
    .description("begin vault collateral withdrawal process from agent's to owner’s address; withdrawal will later be executed automatically by running agent bot")
    .argument("<agentVaultAddress>")
    .argument("<amount>")
    .action(async (agentVault: string, amount: string) => {
        validateDecimal(amount, "amount", { strictMin: 0 });
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        const currency = await Currencies.agentVaultCollateral(cli.context, agentVault);
        await cli.announceWithdrawFromVault(agentVault, currency.parse(amount));
    });

program
    .command("cancelVaultCollateralWithdrawal")
    .description("cancel vault collateral withdrawal process")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
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
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        const currency = await Currencies.agentPoolCollateral(cli.context, agentVault);
        await cli.announceRedeemCollateralPoolTokens(agentVault, currency.parse(amount));
    });

program
    .command("cancelCollateralPoolTokenRedemption")
    .description("cancel collateral pool tokens redemption process")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.cancelCollateralPoolTokensAnnouncement(agentVault);
    });

program
    .command("withdrawPoolFees")
    .description("withdraw pool fees from pool to owner's address")
    .argument("<agentVaultAddress>")
    .argument("<amount>")
    .action(async (agentVault: string, amount: string) => {
        validateDecimal(amount, "amount", { strictMin: 0 });
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        const currency = await Currencies.fasset(cli.context);
        await cli.withdrawPoolFees(agentVault, currency.parse(amount));
    });

program
    .command("poolFeesBalance")
    .description("get pool fees balance of agent")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.poolFeesBalance(agentVault);
    });

program
    .command("selfClose")
    .description("self close agent vault with amountUBA of FAssets")
    .argument("<agentVaultAddress>")
    .argument("<amount>")
    .action(async (agentVault: string, amount: string) => {
        validateDecimal(amount, "amount", { strictMin: 0 });
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        const currency = await Currencies.fasset(cli.context);
        await cli.selfClose(agentVault, currency.parse(amount));
    });

program
    .command("close")
    .description("begin the process of closing agent vault; all the steps required will later be performed automatically by running agent bot")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.closeVault(agentVault);
    });

program
    .command("announceUnderlyingWithdrawal")
    .description("announce underlying withdrawal and get needed payment reference")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.announceUnderlyingWithdrawal(agentVault);
    });

program
    .command("performUnderlyingWithdrawal")
    .description("perform underlying withdrawal and get needed transaction hash")
    .argument("<agentVaultAddress>")
    .argument("<amount>")
    .argument("<destinationAddress>")
    .argument("<paymentReference>")
    .action(async (agentVault: string, amount: string, destinationAddress: string, paymentReference: string) => {
        validateDecimal(amount, "amount", { strictMin: 0 });
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        const currency = await Currencies.fasset(cli.context);
        await cli.performUnderlyingWithdrawal(agentVault, currency.parse(amount), destinationAddress, paymentReference);
    });

program
    .command("confirmUnderlyingWithdrawal")
    .description("confirm underlying withdrawal with transaction hash")
    .argument("<agentVaultAddress>")
    .argument("<txHash>")
    .action(async (agentVault: string, txHash: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.confirmUnderlyingWithdrawal(agentVault, txHash);
    });

program
    .command("cancelUnderlyingWithdrawal")
    .description("cancel underlying withdrawal announcement")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.cancelUnderlyingWithdrawal(agentVault);
    });

program
    .command("listAgents")
    .description("list active agent from persistent state")
    .action(async () => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.listActiveAgents();
    });

program
    .command("delegatePoolCollateral")
    .description("delegate pool collateral, where <bips> is basis points (1/100 of one percent)")
    .argument("<agentVaultAddress>")
    .argument("<recipient>")
    .argument("<share>", "vote power share as decimal number (e.g. 0.3) or percentage (e.g. 30%)")
    .action(async (agentVault: string, recipient: string, share: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.delegatePoolCollateral(agentVault, recipient, toBIPS(share));
    });

program
    .command("undelegatePoolCollateral")
    .description("undelegate pool collateral")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.undelegatePoolCollateral(agentVault);
    });

program
    .command("createUnderlyingAccount")
    .description("create underlying account")
    .action(async () => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        const secrets = Secrets.load(options.secrets);
        const { address, privateKey } = await cli.createUnderlyingAccount(secrets);
        console.log({ address, privateKey });
    });

program
    .command("freeVaultCollateral")
    .description("get free vault collateral")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
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
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
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
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        const freeUnderlying = await cli.getFreeUnderlying(agentVault);
        const currency = await Currencies.fasset(cli.context);
        console.log(`Agent ${agentVault} has ${currency.format(freeUnderlying)} free underlying.`);
    });

program
    .command("switchVaultCollateral")
    .description("switch vault collateral")
    .argument("<agentVaultAddress>")
    .argument("<token>")
    .action(async (agentVault: string, token: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.switchVaultCollateral(agentVault, token);
    });

program
    .command("upgradeWNat")
    .description("upgrade WNat contract")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const cli = await AgentBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        await cli.upgradeWNatContract(agentVault);
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
