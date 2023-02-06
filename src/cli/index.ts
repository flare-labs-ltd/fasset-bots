#!/usr/bin/env node
import { toplevelRun } from "../utils/helpers";
import { BotCliCommands } from "./BotCliCommands";

const chalk = require('chalk')

toplevelRun(async () => {
    const cli = new BotCliCommands();
    await cli.initEnvironment();
    switch (process.argv[2]) {
        case 'create':
            await cli.createAgentVault();
            break;
        case 'deposit':
            const amount = process.argv[3];
            const agentVaultDeposit = process.argv[4];
            if (amount && agentVaultDeposit) {
                const deposit = cli.depositToVault(amount, agentVaultDeposit);
            } else {
                console.log("Missing arguments ", chalk.blue("<amount> <agentVault>"), " for command ", chalk.yellow("deposit"));
            }
            break;
        case 'enter':
            const agentVaultEnter = process.argv[3];
            const feeBIPS = process.argv[4];
            const agentMinCRBIPS = process.argv[5];
            if (agentVaultEnter && feeBIPS && agentMinCRBIPS) {
                const enter = cli.enterAvailableList(agentVaultEnter, feeBIPS, agentMinCRBIPS);
            } else {
                console.log("Missing arguments ", chalk.blue("<agentVault> <feeBIPS> <agentMinCRBIPS>"), " for command ", chalk.yellow("enter"));
            }
            break;
        case 'exit':
            const agentVaultExit = process.argv[3];
            if (agentVaultExit) {
                const enter = cli.exitAvailableList(agentVaultExit);
            } else {
                console.log("Missing argument ", chalk.blue("<agentVault>"), " for command ", chalk.yellow("exit"));
            }
            break;
        default:
            console.log("\n ", 'Usage: ' + chalk.green('fasset-bots-cli') + ' ' + chalk.yellow('[command]') + ' ' + chalk.blue('<arg>') + '', "\n")
            console.log('  Available commands:', "\n")
            console.log(chalk.yellow('  create'), "\t\t\t\t\t\t", "create new agent vault")
            console.log(chalk.yellow('  deposit'), "\t", chalk.blue('<amount> <agentVault>'), "\t\t\t", "deposit amount to agent vault from owner's address")
            console.log(chalk.yellow('  enter'), "\t", chalk.blue('<agentVault> <feeBIPS> <agentMinCRBIPS>'), "enter available agent's list")
            console.log(chalk.yellow('  exit'), "\t\t", chalk.blue('<agentVault>'), "\t\t\t\t", "exit available agent's list", "\n")
            process.exit(-1)
    }
});