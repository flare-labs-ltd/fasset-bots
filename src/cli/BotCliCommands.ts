import { FilterQuery } from "@mikro-orm/core";
import { AgentBot } from "../actors/AgentBot";
import { AgentEntity } from "../entities/agent";
import { createAssetContext } from "../config/create-asset-context";
import { BotConfig, createBotConfig, RunConfig } from "../config/BotConfig";
import { IAssetBotContext } from "../fasset-bots/IAssetBotContext";
import { initWeb3 } from "../utils/web3";
import { requireEnv, toBN } from "../utils/helpers";
import * as dotenv from "dotenv";
import { readFileSync } from "fs";
import { time } from "@openzeppelin/test-helpers";
import chalk from 'chalk';
dotenv.config();

const OWNER_ADDRESS: string = requireEnv('OWNER_ADDRESS');
const OWNER_PRIVATE_KEY: string = requireEnv('OWNER_PRIVATE_KEY');
const RUN_CONFIG_PATH: string = requireEnv('RUN_CONFIG_PATH');

export class BotCliCommands {

    context!: IAssetBotContext;
    ownerAddress!: string;
    botConfig!: BotConfig;

    async initEnvironment(): Promise<void> {
        console.log(chalk.cyan('Initializing environment...'));
        const runConfig = JSON.parse(readFileSync(RUN_CONFIG_PATH).toString()) as RunConfig;
        const accounts = await initWeb3(runConfig.rpcUrl, [OWNER_PRIVATE_KEY], null);
        this.botConfig = await createBotConfig(runConfig, OWNER_ADDRESS);
        this.ownerAddress = accounts[0];
        this.context = await createAssetContext(this.botConfig, this.botConfig.chains[0]);
        console.log(chalk.cyan('Environment successfully initialized.'));
    }

    async createAgentVault(): Promise<string> {
        const agentBot = await AgentBot.create(this.botConfig.orm.em, this.context, this.ownerAddress, this.botConfig.notifier);
        console.log(chalk.cyan(`Agent ${agentBot.agent.vaultAddress} was created.`));
        return agentBot.agent.vaultAddress;
    }

    async depositToVault(agentVault: string, amount: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.depositCollateral(amount);
        console.log(chalk.cyan(`Deposit of ${amount} to agent ${agentVault} was successful.`));
    }

    async enterAvailableList(agentVault: string, feeBIPS: string, collateralRatioBIPS: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.makeAvailable(feeBIPS, collateralRatioBIPS);
        console.log(chalk.cyan(`Agent ${agentVault} ENTERED available list.`));
    }

    async exitAvailableList(agentVault: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.exitAvailable();
        console.log(chalk.cyan(`Agent ${agentVault} EXITED available list.`));
    }

    async withdrawFromVault(agentVault: string, amount: string): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        await agentBot.agent.announceCollateralWithdrawal(amount);
        console.log(chalk.cyan(`Withdraw of ${amount} from agent ${agentVault} has been announced.`));
        agentEnt.waitingForWithdrawalTimestamp = (await time.latest()).toNumber();
        agentEnt.waitingForWithdrawalAmount = toBN(amount);
        // continue inside AgentBot
    }

    async selfClose(agentVault: string, amountUBA: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.selfClose(amountUBA);
        console.log(chalk.cyan(`Agent ${agentVault} self closed successfully.`));
    }

    async setAgentMinCR(agentVault: string, agentMinCollateralRationBIPS: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await this.context.assetManager.setAgentMinCollateralRatioBIPS(agentVault, agentMinCollateralRationBIPS, { from: agentBot.agent.ownerAddress });
        console.log(chalk.cyan(`Agent's min collateral ratio was successfully set to ${agentMinCollateralRationBIPS}.`));
    }

    async closeVault(agentVault: string): Promise<void> {
        const agentEnt = await this.botConfig.orm.em.getRepository(AgentEntity).findOneOrFail({ vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const agentInfo = await this.context.assetManager.getAgentInfo(agentVault);
        if (agentInfo.publiclyAvailable) {
            await this.exitAvailableList(agentVault);
        }
        agentEnt.waitingForDestructionCleanUp = true;
        await this.botConfig.orm.em.persist(agentEnt).flush();
    }

    async getAgentBot(agentVault: string): Promise<{ agentBot: AgentBot, agentEnt: AgentEntity }> {
        const agentEnt = await this.botConfig.orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(this.context, agentEnt, this.botConfig.notifier);
        return { agentBot, agentEnt };
    }

    async run(args: string[]): Promise<void> {
        switch (args[2]) {
            case 'create':
                await this.createAgentVault();
                break;
            case 'deposit': {
                const agentVaultDeposit = args[3];
                const amount = args[4];
                if (agentVaultDeposit && amount) {
                    await this.depositToVault(agentVaultDeposit, amount);
                } else {
                    console.log("Missing arguments ", chalk.blue("<agentVault> <amount>"), " for command ", chalk.yellow("deposit"));
                }
                break;
            }
            case 'enter': {
                const agentVaultEnter = args[3];
                const feeBips = args[4];
                const agentMinCrBips = args[5];
                if (agentVaultEnter && feeBips && agentMinCrBips) {
                    await this.enterAvailableList(agentVaultEnter, feeBips, agentMinCrBips);
                } else {
                    console.log("Missing arguments ", chalk.blue("<agentVault> <feeBips> <agentMinCrBips>"), " for command ", chalk.yellow("enter"));
                }
                break;
            }
            case 'exit': {
                const agentVaultExit = args[3];
                if (agentVaultExit) {
                    await this.exitAvailableList(agentVaultExit);
                } else {
                    console.log("Missing argument ", chalk.blue("<agentVault>"), " for command ", chalk.yellow("exit"));
                }
                break;
            }
            case 'setMinCR': {
                const agentVaultMinCR = args[3];
                const minCollateralRatioBIPS = args[4];
                if (agentVaultMinCR && minCollateralRatioBIPS) {
                    await this.setAgentMinCR(agentVaultMinCR, minCollateralRatioBIPS);
                } else {
                    console.log("Missing arguments ", chalk.blue("<agentVault>, <agentMinCrBips>"), " for command ", chalk.yellow("setMinCr"));
                }
                break;
            }
            case 'withdraw': {
                const agentVaultWithdraw = args[3];
                const amountWithdraw = args[4];
                if (agentVaultWithdraw && amountWithdraw) {
                    await this.withdrawFromVault(agentVaultWithdraw, amountWithdraw);
                } else {
                    console.log("Missing arguments ", chalk.blue("<agentVault>, <amount>"), " for command ", chalk.yellow("withdraw"));
                }
                break;
            }
            case 'selfClose': {
                const agentVaultSelfClose = args[3];
                const amountSelfClose = args[4];
                if (agentVaultSelfClose && amountSelfClose) {
                    await this.selfClose(agentVaultSelfClose, amountSelfClose);
                } else {
                    console.log("Missing arguments ", chalk.blue("<agentVault>, <amount>"), " for command ", chalk.yellow("selfClose"));
                }
                break;
            }
            case 'close': {
                const agentVaultClose = args[3];
                if (agentVaultClose) {
                    await this.closeVault(agentVaultClose);
                } else {
                    console.log("Missing argument ", chalk.blue("<agentVault>"), " for command ", chalk.yellow("close"));
                }
                break;
            }
            default:
                listUsageAndCommands();
        }
    }
}

export function listUsageAndCommands() {
    console.log("\n ", 'Usage: ' + chalk.green('fasset-bots-cli') + ' ' + chalk.yellow('[command]') + ' ' + chalk.blue('<arg>') + '', "\n");
    console.log('  Available commands:', "\n");
    console.log(chalk.yellow('  create'), "\t\t\t\t\t\t", "create new agent vault");
    console.log(chalk.yellow('  deposit'), "\t", chalk.blue('<agentVault> <amount>'), "\t\t\t", "deposit amount to agent vault from owner's address");
    console.log(chalk.yellow('  enter'), "\t", chalk.blue('<agentVault> <feeBips> <agentMinCrBips>'), "enter available agent's list");
    console.log(chalk.yellow('  exit'), "\t\t", chalk.blue('<agentVault>'), "\t\t\t\t", "exit available agent's list");
    console.log(chalk.yellow('  setMinCr'), "\t", chalk.blue('<agentVault> <agentMinCrBips>'), "\t\t", "set agent's min CR in BIPS");
    console.log(chalk.yellow('  withdraw'), "\t", chalk.blue('<agentVault> <amount>'), "\t\t\t", "withdraw amount from agent vault to owner's address");
    console.log(chalk.yellow('  selfClose'), "\t", chalk.blue('<agentVault> <amountUBA>'), "\t\t", "self close agent vault with amountUBA of FAssets");
    console.log(chalk.yellow('  close'), "\t", chalk.blue('<agentVault>'), "\t\t\t\t", "close agent vault", "\n");
}