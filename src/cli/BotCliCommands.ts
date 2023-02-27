import { FilterQuery } from "@mikro-orm/core";
import { AgentBot } from "../actors/AgentBot";
import { AgentEntity } from "../entities/agent";
import { createAssetContext } from "../config/create-asset-context";
import { createBotConfig, RunConfig } from "../config/BotConfig";
import { IAssetBotContext } from "../fasset-bots/IAssetBotContext";
import { ORM } from "../config/orm";
import { initWeb3 } from "../utils/web3";
import { requireEnv, sleep, toBN } from "../utils/helpers";
import * as dotenv from "dotenv";
import { readFileSync } from "fs";
dotenv.config();

const OWNER_ADDRESS: string = requireEnv('OWNER_ADDRESS');
const OWNER_PRIVATE_KEY: string = requireEnv('OWNER_PRIVATE_KEY');
const RUN_CONFIG_PATH: string = requireEnv('RUN_CONFIG_PATH');

export class BotCliCommands {

    context!: IAssetBotContext;
    orm!: ORM;
    ownerAddress!: string;

    async initEnvironment(): Promise<void> {
        const runConfig = JSON.parse(readFileSync(RUN_CONFIG_PATH).toString()) as RunConfig;
        const accounts = await initWeb3(runConfig.rpcUrl, [OWNER_PRIVATE_KEY], null);
        const botConfig = await createBotConfig(runConfig, OWNER_ADDRESS);
        this.ownerAddress = accounts[0];
        this.context = await createAssetContext(botConfig, botConfig.chains[0]);
        this.orm = botConfig.orm;
    }

    async createAgentVault(): Promise<string> {
        const agentBot = await AgentBot.create(this.orm.em, this.context, this.ownerAddress);
        return agentBot.agent.vaultAddress;
    }

    async depositToVault(agentVault: string, amount: string): Promise<void> {
        const agentEnt = await this.orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(this.context, agentEnt);
        await agentBot.agent.depositCollateral(amount);
    }

    async enterAvailableList(agentVault: string, feeBIPS: string, collateralRatioBIPS: string): Promise<void> {
        const agentEnt = await this.orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(this.context, agentEnt);
        await agentBot.agent.makeAvailable(feeBIPS, collateralRatioBIPS);
    }

    async exitAvailableList(agentVault: string): Promise<void> {
        const agentEnt = await this.orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(this.context, agentEnt);
        await agentBot.agent.exitAvailable();
    }

    async withdrawFromVault(agentVault: string, amount: string) {
        const agentEnt = await this.orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(this.context, agentEnt);
        await agentBot.agent.announceCollateralWithdrawal(amount);
        const settings = await this.context.assetManager.getSettings();
        await sleep(toBN(settings.withdrawalWaitMinSeconds).muln(1000).toNumber());
        await agentBot.agent.withdrawCollateral(amount);
    }

    async selfClose(agentVault: string, amountUBA: string) {
        const agentEnt = await this.orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(this.context, agentEnt);
        await agentBot.agent.selfClose(amountUBA);
    }
}