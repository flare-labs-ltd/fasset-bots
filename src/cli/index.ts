#!/usr/bin/env node

import { createAgentVault, depositToVault, enterAvailableList, exitAvailableList } from "./commands";

const { Command } = require("commander");
const figlet = require("figlet");

const program = new Command();
console.log(figlet.textSync("FAsset bots"));

program
  .name("fassetBotsCli")

program.command("create")
    .description("create new agent vault from owner's address")
    .argument("<ownerAddress>", "owner's address")
    .action(createAgentVault);

program.command("deposit")
    .description("deposit amount to agent vault from owner's address")
    .argument("<amount>", "amount to deposit")
    .argument("<agentVault>", "agent's vault address")
    .action(depositToVault);

program.command("enter")
    .description("enter available agent's list")
    .argument("<agentVault>", "agent's vault address")
    .argument("<feeBIPS>", "fee charged to minters (in underlying currency)")
    .argument("<agentMinCollateralRatioBIPS>", "ratio at which free collateral for the minting will be accounted")
    .action(enterAvailableList);

program.command("exit")
    .description("exit available agent's list")
    .argument("<agentVault>", "agent's vault address")
    .action(exitAvailableList);

program.parse();

