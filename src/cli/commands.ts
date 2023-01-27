#!/usr/bin/env node
import { FilterQuery } from "@mikro-orm/core";
import { AgentBot } from "../actors/AgentBot";
import { createOrm, CreateOrmOptions, ORM } from "../config/orm";
import { AgentEntity } from "../entities/agent";
import { IAssetBotContext } from "../fasset-bots/IAssetBotContext";
import options from "../mikro-orm.config";
import { getSourceName, SourceId } from "../verification/sources/sources";
import inquirer from 'inquirer';
import { requireEnv } from "../utils/helpers";
import { createTestOrm } from "../../test/test.mikro-orm.config";
import { createTestConfigNoMocks } from "../../test/utils/test-bot-config";
import { createAssetContext } from "../config/create-asset-context";
import { BotConfig } from "../config/BotConfig";
import chalk from 'chalk';

let orm: ORM;
let botConfig: BotConfig;

function checkEnvironment() {
    if (!botConfig || !orm) {
        console.log(chalk.red("Missing bot config file!"));
        process.exit(1);
    }
}

export async function createAgentVault(ownerAddress: string) {
    checkEnvironment();
    const context = await createAssetContext(botConfig, botConfig.chains[0]);
    await AgentBot.create(orm.em, context, ownerAddress);
}

export async function depositToVault(amount: string, agentVault: string) {
    checkEnvironment();
    const context = await createAssetContext(botConfig, botConfig.chains[0]);
    const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
    const agentBot = await AgentBot.fromEntity(context, agentEnt);
    await agentBot.agent.depositCollateral(amount);
}

export async function enterAvailableList(agentVault: string, feeBIPS: string, collateralRatioBIPS: string) {
    checkEnvironment();
    const context = await createAssetContext(botConfig, botConfig.chains[0]);
    const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
    const agentBot = await AgentBot.fromEntity(context, agentEnt);
    await agentBot.agent.makeAvailable(feeBIPS, collateralRatioBIPS);
}

export async function exitAvailableList(agentVault: string, ownerAddress: string) {
    checkEnvironment();
    const context = await createAssetContext(botConfig, botConfig.chains[0]);
    const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
    const agentBot = await AgentBot.fromEntity(context, agentEnt);
    await agentBot.agent.exitAvailable();
}