import { FilterQuery } from "@mikro-orm/core";
import { AgentBot } from "../actors/AgentBot";
import { ORM } from "../config/orm";
import { AgentEntity } from "../entities/agent";
import { createAssetContext } from "../config/create-asset-context";
import { BotConfig } from "../config/BotConfig";
import chalk from 'chalk';

let botConfig: BotConfig;

function checkEnvironment() {
    if (!botConfig) {
        console.log(chalk.red("Missing config file!"));
        process.exit(1);
    }
}

export async function createAgentVault(ownerAddress: string) {
    checkEnvironment();
    const context = await createAssetContext(botConfig, botConfig.chains[0]);
    await AgentBot.create(botConfig.orm.em, context, ownerAddress);
}

export async function depositToVault(amount: string, agentVault: string) {
    checkEnvironment();
    const context = await createAssetContext(botConfig, botConfig.chains[0]);
    const agentEnt = await botConfig.orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
    const agentBot = await AgentBot.fromEntity(context, agentEnt);
    await agentBot.agent.depositCollateral(amount);
}

export async function enterAvailableList(agentVault: string, feeBIPS: string, collateralRatioBIPS: string) {
    checkEnvironment();
    const context = await createAssetContext(botConfig, botConfig.chains[0]);
    const agentEnt = await botConfig.orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
    const agentBot = await AgentBot.fromEntity(context, agentEnt);
    await agentBot.agent.makeAvailable(feeBIPS, collateralRatioBIPS);
}

export async function exitAvailableList(agentVault: string, ownerAddress: string) {
    checkEnvironment();
    const context = await createAssetContext(botConfig, botConfig.chains[0]);
    const agentEnt = await botConfig.orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
    const agentBot = await AgentBot.fromEntity(context, agentEnt);
    await agentBot.agent.exitAvailable();
}