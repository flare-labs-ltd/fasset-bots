import { Command } from "commander";
import { toplevelRun } from "../utils/helpers";
import { BotCliCommands } from "../actors/AgentBotCliCommands";

const program = new Command();

program.addOption(program.createOption("-f, --fasset <fAssetSymbol>", "The symbol of the FAsset to mint, redeem or query").makeOptionMandatory(true));

program.name("agent-bot").description("Command line commands for AgentBot");

program
    .command("create")
    .description("create new agent vault")
    .action(async () => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.createAgentVault();
    });

program
    .command("depositVaultCollateral")
    .description("deposit vault collateral to agent vault from owner's address")
    .argument("<agentVaultAddress>")
    .argument("<amount>")
    .action(async (agentVault: string, amount: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.depositToVault(agentVault, amount);
    });

program
    .command("buyPoolCollateral")
    .description("add pool collateral and agent pool tokens")
    .argument("<agentVaultAddress>")
    .argument("<amount>")
    .action(async (agentVault: string, amount: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.buyCollateralPoolTokens(agentVault, amount);
    });

program
    .command("enter")
    .description("enter available agent's list")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.enterAvailableList(agentVault);
    });

program
    .command("announceExit")
    .description("announce exit available agent's list")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.announceExitAvailableList(agentVault);
    });

program
    .command("exit")
    .description("exit available agent's list")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.announceExitAvailableList(agentVault);
    });

program
    .command("updateAgentSetting")
    .description("set agent's settings")
    .argument("<agentVaultAddress>")
    .argument("<agentSettingName>")
    .argument("<agentSettingValue>")
    .action(async (agentVault: string, settingName: string, settingValue: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.updateAgentSetting(agentVault, settingName, settingValue);
    });

program
    .command("withdrawVaultCollateral")
    .description("withdraw amount from agent vault to owner’s address")
    .argument("<agentVaultAddress>")
    .argument("<amount")
    .action(async (agentVault: string, amount: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.withdrawFromVault(agentVault, amount);
    });

program
    .command("withdrawPoolFees")
    .description("withdraw pool fees from pool to owner's address")
    .argument("<agentVaultAddress>")
    .argument("<amount>")
    .action(async (agentVault: string, amount: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.withdrawPoolFees(agentVault, amount);
    });

program
    .command("poolFeesBalance")
    .description("get pool fees balance of agent")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.poolFeesBalance(agentVault);
    });

program
    .command("selfClose")
    .description("self close agent vault with amountUBA of FAssets")
    .argument("<agentVaultAddress>")
    .argument("<amountUBA>")
    .action(async (agentVault: string, amountUBA: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.selfClose(agentVault, amountUBA);
    });

program
    .command("close")
    .description("close agent vault")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.closeVault(agentVault);
    });

program
    .command("announceUnderlyingWithdrawal")
    .description("announce underlying withdrawal and get needed payment reference")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
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
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.performUnderlyingWithdrawal(agentVault, amount, destinationAddress, paymentReference);
    });

program
    .command("confirmUnderlyingWithdrawal")
    .description("confirm underlying withdrawal with transaction hash")
    .argument("<agentVaultAddress>")
    .argument("<txHash>")
    .action(async (agentVault: string, txHash: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.confirmUnderlyingWithdrawal(agentVault, txHash);
    });

program
    .command("cancelUnderlyingWithdrawal")
    .description("cancel underlying withdrawal announcement")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.cancelUnderlyingWithdrawal(agentVault);
    });

program
    .command("listAgents")
    .description("list active agent from persistent state")
    .action(async () => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.listActiveAgents();
    });

program
    .command("delegatePoolCollateral")
    .description("delegate pool collateral, where <delegates> and <amounts> are comma separated strings")
    .argument("<agentVaultAddress>")
    .argument("<delegates>")
    .argument("<amounts>")
    .action(async (agentVault: string, delegates: string, amounts: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.delegatePoolCollateral(agentVault, delegates, amounts);
    });

program
    .command("undelegatePoolCollateral")
    .description("undelegate pool collateral")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.undelegatePoolCollateral(agentVault);
    });

toplevelRun(async () => {
    await program.parseAsync();
});
