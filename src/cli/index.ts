import { createAgentVault, depositToVault, enterAvailableList, exitAvailableList } from "./commands";

const { Command } = require("commander");
const figlet = require("figlet");

const program = new Command();
console.log(figlet.textSync("FAsset bots"));

program.command('create <ownerAddress>')
    .description("create new agent vault from owner's address")
    .action(createAgentVault);

program.command('deposit <amount> <agentVault>')
    .description("deposit amount to agent vault from owner's address")
    .action(depositToVault);

program.command('enter <agentVault> <feeBIPS> <collateralRatioBIPS>')
    .description("enter available agent's list")
    .action(enterAvailableList);

program.command('exit <agentVault>')
    .description("exit available agent's list")
    .action(exitAvailableList);

program.parse();

