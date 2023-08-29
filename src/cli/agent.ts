import { Command } from "commander";
import { toplevelRun } from "../utils/helpers";
import { BotCliCommands } from "../actors/AgentBotCliCommands";

const program = new Command();

program
    .name("agent-bot")
    .description("Command line commands for AgentBot");

program.command("create")
    .description("create new agent vault")
    .action(async () => {
        const cli = await BotCliCommands.create();
        await cli.createAgentVault();
    });

program.command("depositVaultCollateral")
    .description("deposit vault collateral to agent vault from owner's address")
    .argument("<agentVaultAddress>")
    .argument("<amount>")
    .action(async (agentVault: string, amount: string) => {
        const cli = await BotCliCommands.create();
        await cli.depositToVault(agentVault, amount);
    });

program.command("buyPoolCollateral")
    .description("add pool collateral and agent pool tokens")
    .argument("<agentVaultAddress>")
    .argument("<amount>")
    .action(async (agentVault: string, amount: string) => {
        const cli = await BotCliCommands.create();
        await cli.buyCollateralPoolTokens(agentVault, amount);
    });

program.command("enter")
    .description("enter available agent's list")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const cli = await BotCliCommands.create();
        await cli.enterAvailableList(agentVault);
    });

program.command("exit")
    .description("exit available agent's list")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const cli = await BotCliCommands.create();
        await cli.announceExitAvailableList(agentVault);
    });

program.command("updateAgentSetting")
    .description("set agent's settings")
    .argument("<agentVaultAddress>")
    .argument("<agentSettingName>")
    .argument("<agentSettingValue>")
    .action(async (agentVault: string, settingName: string, settingValue: string) => {
        const cli = await BotCliCommands.create();
        await cli.updateAgentSetting(agentVault, settingName, settingValue);
    });

program.command("withdrawVaultCollateral")
    .description("withdraw amount from agent vault to owner's address")
    .argument("<agentVaultAddress>")
    .argument("<agentSettingName>")
    .argument("<agentSettingValue>")
    .action(async (agentVault: string, settingName: string, settingValue: string) => {
        const cli = await BotCliCommands.create();
        await cli.updateAgentSetting(agentVault, settingName, settingValue);
    });

program.command("withdrawPoolFees")
    .description("withdraw pool fees from pool to owner's address")
    .argument("<agentVaultAddress>")
    .argument("<agentSettingName>")
    .argument("<agentSettingValue>")
    .action(async (agentVault: string, settingName: string, settingValue: string) => {
        const cli = await BotCliCommands.create();
        await cli.updateAgentSetting(agentVault, settingName, settingValue);
    });

program.command("poolFeesBalance")
    .description("get pool fees balance of agent")
    .argument("<agentVaultAddress>")
    .argument("<agentSettingName>")
    .argument("<agentSettingValue>")
    .action(async (agentVault: string, settingName: string, settingValue: string) => {
        const cli = await BotCliCommands.create();
        await cli.updateAgentSetting(agentVault, settingName, settingValue);
    });

program.command("selfClose")
    .description("self close agent vault with amountUBA of FAssets")
    .argument("<agentVaultAddress>")
    .argument("<agentSettingName>")
    .argument("<agentSettingValue>")
    .action(async (agentVault: string, settingName: string, settingValue: string) => {
        const cli = await BotCliCommands.create();
        await cli.updateAgentSetting(agentVault, settingName, settingValue);
    });

program.command("close")
    .description("close agent vault")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const cli = await BotCliCommands.create();
        await cli.closeVault(agentVault);
    });

program.command("announceUnderlyingWithdrawal")
    .description("announce underlying withdrawal and get needed payment reference")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const cli = await BotCliCommands.create();
        await cli.announceUnderlyingWithdrawal(agentVault);
    });

program.command("performUnderlyingWithdrawal")
    .description("perform underlying withdrawal and get needed transaction hash")
    .argument("<agentVaultAddress>")
    .argument("<amount>")
    .argument("<destinationAddress>")
    .argument("<paymentReference>")
    .action(async (agentVault: string, amount: string, destinationAddress: string, paymentReference: string) => {
        const cli = await BotCliCommands.create();
        await cli.performUnderlyingWithdrawal(agentVault, amount, destinationAddress, paymentReference);
    });

program.command("confirmUnderlyingWithdrawal")
    .description("confirm underlying withdrawal with transaction hash")
    .argument("<agentVaultAddress>")
    .argument("<txHash>")
    .action(async (agentVault: string, txHash: string) => {
        const cli = await BotCliCommands.create();
        await cli.confirmUnderlyingWithdrawal(agentVault, txHash);
    });

program.command("cancelUnderlyingWithdrawal")
    .description("cancel underlying withdrawal announcement")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const cli = await BotCliCommands.create();
        await cli.cancelUnderlyingWithdrawal(agentVault);
    });

program.command("listAgents")
    .description("list active agent from persistent state")
    .action(async () => {
        const cli = await BotCliCommands.create();
        await cli.listActiveAgents();
    });

program.command("delegatePoolCollateral")
    .description("delegate pool collateral, where <delegates> and <amounts> are comma separated strings")
    .argument("<agentVaultAddress>")
    .argument("<delegates>")
    .argument("<amounts>")
    .action(async (agentVault: string, delegates: string, amounts: string) => {
        const cli = await BotCliCommands.create();
        await cli.delegatePoolCollateral(agentVault, delegates, amounts);
    });

program.command("undelegatePoolCollateral")
    .description("undelegate pool collateral")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const cli = await BotCliCommands.create();
        await cli.undelegatePoolCollateral(agentVault);
    });

toplevelRun(async () => {
    await program.parseAsync();
});