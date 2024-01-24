import "dotenv/config";
import "source-map-support/register";

import { Command } from "commander";
import { toBIPS, toplevelRun } from "@flarelabs/fasset-bots-core/utils";
import { AgentTokenConverter, BotCliCommands } from "@flarelabs/fasset-bots-core";

const program = new Command();

program.addOption(program.createOption("-f, --fasset <fAssetSymbol>", "The symbol of the FAsset to mint, redeem or query").makeOptionMandatory(true));

program.name("agent-bot").description("Command line commands for AgentBot");

program
    .command("create")
    .description("create new agent vault")
    .argument("<poolTokenSuffix>")
    .action(async (poolTokenSuffix: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.createAgentVault(poolTokenSuffix);
    });

program
    .command("depositVaultCollateral")
    .description("deposit vault collateral to agent vault from owner's address")
    .argument("<agentVaultAddress>")
    .argument("<amount>")
    .action(async (agentVault: string, amount: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        const converter = new AgentTokenConverter(cli.context, agentVault, 'vault');
        await cli.depositToVault(agentVault, await converter.parseToWei(amount));
    });

program
    .command("buyPoolCollateral")
    .description("add pool collateral and agent pool tokens")
    .argument("<agentVaultAddress>")
    .argument("<amount>")
    .action(async (agentVault: string, amount: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        const converter = new AgentTokenConverter(cli.context, agentVault, 'pool');
        await cli.buyCollateralPoolTokens(agentVault, await converter.parseToWei(amount));
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
        await cli.exitAvailableList(agentVault);
    });

program
    .command("info")
    .description("print agent info")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.printAgentInfo(agentVault);
    });

program
    .command("getAgentSettings")
    .description("print agent settings")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.printAgentSettings(agentVault);
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
    .command("announceVaultCollateralWithdrawal")
    .description("announce vault collateral withdrawal from agent's to owner’s address")
    .argument("<agentVaultAddress>")
    .argument("<amount")
    .action(async (agentVault: string, amount: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        const converter = new AgentTokenConverter(cli.context, agentVault, 'vault');
        await cli.announceWithdrawFromVault(agentVault, await converter.parseToWei(amount));
    });

program
    .command("cancelVaultCollateralWithdrawal")
    .description("cancel vault collateral withdrawal announcement")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string,) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.cancelWithdrawFromVaultAnnouncement(agentVault);
    });

program
    .command("announceCollateralPoolTokenRedemption")
    .description("announce collateral pool tokens redemption from agent's to owner’s address")
    .argument("<agentVaultAddress>")
    .argument("<amount")
    .action(async (agentVault: string, amount: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        const converter = new AgentTokenConverter(cli.context, agentVault, 'pool');
        await cli.announceRedeemCollateralPoolTokens(agentVault, await converter.parseToWei(amount));
    });

program
    .command("cancelCollateralPoolTokenRedemption")
    .description("cancel collateral pool tokens redemption announcement")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.cancelCollateralPoolTokensAnnouncement(agentVault);
    });

program
    .command("withdrawPoolFees")
    .description("withdraw pool fees from pool to owner's address")
    .argument("<agentVaultAddress>")
    .argument("<amount>")
    .action(async (agentVault: string, amount: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        const converter = new AgentTokenConverter(cli.context, agentVault, 'fasset');
        await cli.withdrawPoolFees(agentVault, await converter.parseToWei(amount));
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
    .argument("<amount>")
    .action(async (agentVault: string, amount: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        const converter = new AgentTokenConverter(cli.context, agentVault, 'fasset');
        await cli.selfClose(agentVault, await converter.parseToWei(amount));
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
        const converter = new AgentTokenConverter(cli.context, agentVault, 'fasset');
        await cli.performUnderlyingWithdrawal(agentVault, await converter.parseToWei(amount), destinationAddress, paymentReference);
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
    .description("delegate pool collateral, where <bips> is basis points (1/100 of one percent)")
    .argument("<agentVaultAddress>")
    .argument("<recipient>")
    .argument("<share>", "vote power share as decimal number (e.g. 0.3) or percentage (e.g. 30%)")
    .action(async (agentVault: string, recipient: string, share: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.delegatePoolCollateral(agentVault, recipient, toBIPS(share));
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

program
    .command("createUnderlyingAccount")
    .description("create underlying account")
    .action(async () => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.createUnderlyingAccount();
    });

program
    .command("freeVaultCollateral")
    .description("get free vault collateral")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        const freeCollateral = await cli.getFreeVaultCollateral(agentVault);
        const converter = new AgentTokenConverter(cli.context, agentVault, 'vault');
        console.log(`Agent ${agentVault} has ${converter.formatAsTokensWithUnit(freeCollateral)} free vault collateral.`);
    });

program
    .command("freePoolCollateral")
    .description("get free pool collateral")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        const freeCollateral = await cli.getFreePoolCollateral(agentVault);
        const converter = new AgentTokenConverter(cli.context, agentVault, 'pool');
        console.log(`Agent ${agentVault} has ${converter.formatAsTokensWithUnit(freeCollateral) } free pool collateral.`);
    });

program
    .command("freeUnderlying")
    .description("get free underlying balance")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        const freeUnderlying = await cli.getFreeUnderlying(agentVault);
        const converter = new AgentTokenConverter(cli.context, agentVault, 'fasset');
        console.log(`Agent ${agentVault} has ${converter.formatAsTokensWithUnit(freeUnderlying) } free underlying.`);
    });

program
    .command("switchVaultCollateral")
    .description("switch vault collateral")
    .argument("<agentVaultAddress>")
    .argument("<token>")
    .action(async (agentVault: string, token: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.switchVaultCollateral(agentVault, token);
    });

program
    .command("upgradeWNat")
    .description("upgrade WNat contract")
    .argument("<agentVaultAddress>")
    .action(async (agentVault: string) => {
        const options: { fasset: string } = program.opts();
        const cli = await BotCliCommands.create(options.fasset);
        await cli.upgradeWNatContract(agentVault);
    });

toplevelRun(async () => {
    await program.parseAsync();
});
