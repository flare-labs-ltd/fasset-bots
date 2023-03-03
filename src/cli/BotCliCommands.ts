import { FilterQuery } from "@mikro-orm/core";
import { AgentBot } from "../actors/AgentBot";
import { AgentEntity } from "../entities/agent";
import { createAssetContext } from "../config/create-asset-context";
import { createBotConfig, RunConfig } from "../config/BotConfig";
import { IAssetBotContext } from "../fasset-bots/IAssetBotContext";
import { ORM } from "../config/orm";
import { initWeb3 } from "../utils/web3";
import { requireEnv, toBN } from "../utils/helpers";
import * as dotenv from "dotenv";
import { readFileSync } from "fs";
import { time } from "@openzeppelin/test-helpers";
const chalk = require('chalk');
dotenv.config();

const OWNER_ADDRESS: string = requireEnv('OWNER_ADDRESS');
const OWNER_PRIVATE_KEY: string = requireEnv('OWNER_PRIVATE_KEY');
const RUN_CONFIG_PATH: string = requireEnv('RUN_CONFIG_PATH');

export class BotCliCommands {

    context!: IAssetBotContext;
    orm!: ORM;
    ownerAddress!: string;

    async initEnvironment(): Promise<void> {
        console.log(chalk.cyan('Initializing environment...'));
        const runConfig = JSON.parse(readFileSync(RUN_CONFIG_PATH).toString()) as RunConfig;
        const accounts = await initWeb3(runConfig.rpcUrl, [OWNER_PRIVATE_KEY], null);
        const botConfig = await createBotConfig(runConfig, OWNER_ADDRESS);
        this.ownerAddress = accounts[0];
        this.context = await createAssetContext(botConfig, botConfig.chains[0]);
        this.orm = botConfig.orm;
        console.log(chalk.cyan('Environment successfully initialized.'));
    }

    async createAgentVault(): Promise<string> {
        const agentBot = await AgentBot.create(this.orm.em, this.context, this.ownerAddress);
        console.log(chalk.cyan(`Agent ${agentBot.agent.vaultAddress} was created.`));
        return agentBot.agent.vaultAddress;
    }

    async depositToVault(agentVault: string, amount: string): Promise<void> {
        const agentEnt = await this.orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(this.context, agentEnt);
        await agentBot.agent.depositCollateral(amount);
        console.log(chalk.cyan(`Deposit of ${amount} to agent ${agentVault} was successful.`));
    }

    async enterAvailableList(agentVault: string, feeBIPS: string, collateralRatioBIPS: string): Promise<void> {
        const agentEnt = await this.orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(this.context, agentEnt);
        await agentBot.agent.makeAvailable(feeBIPS, collateralRatioBIPS);
        console.log(chalk.cyan(`Agent ${agentVault} ENTERED available list.`));
    }

    async exitAvailableList(agentVault: string): Promise<void> {
        const agentEnt = await this.orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(this.context, agentEnt);
        await agentBot.agent.exitAvailable();
        console.log(chalk.cyan(`Agent ${agentVault} EXITED available list.`));
    }

    async withdrawFromVault(agentVault: string, amount: string): Promise<void> {
        const agentEnt = await this.orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(this.context, agentEnt);
        await agentBot.agent.announceCollateralWithdrawal(amount);
        console.log(chalk.cyan(`Withdraw of ${amount} from agent ${agentVault} has been announced.`));
        agentEnt.waitingForWithdrawalTimestamp = (await time.latest()).toNumber();
        agentEnt.waitingForWithdrawalAmount= toBN(amount);
        // continue inside AgentBot
    }

    async selfClose(agentVault: string, amountUBA: string): Promise<void> {
        const agentEnt = await this.orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(this.context, agentEnt);
        await agentBot.agent.selfClose(amountUBA);
        console.log(chalk.cyan(`Agent ${agentVault} self closed successfully.`));
    }

    async setAgentMinCR(agentVault: string, agentMinCollateralRationBIPS: string): Promise<void> {
        const agentEnt = await this.orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(this.context, agentEnt);
        await this.context.assetManager.setAgentMinCollateralRatioBIPS(agentVault, agentMinCollateralRationBIPS, { from: agentBot.agent.ownerAddress });
        console.log(chalk.cyan(`Agent's min collateral ratio was successfully set to ${agentMinCollateralRationBIPS}.`));
    }

    async closeVault(agentVault: string): Promise<void> {
        const agentEnt = await this.orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const agentInfo = await this.context.assetManager.getAgentInfo(agentVault);
        if (agentInfo.publiclyAvailable) {
            await this.exitAvailableList(agentVault);
        }
        agentEnt.waitingForDestructionCleanUp = true;
        // continue inside AgentBot
    }
}