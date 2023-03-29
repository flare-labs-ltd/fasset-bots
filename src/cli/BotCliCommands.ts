import { FilterQuery } from "@mikro-orm/core";
import { AgentBot } from "../actors/AgentBot";
import { AgentEntity } from "../entities/agent";
import { createAssetContext } from "../config/create-asset-context";
import { AgentSettingsConfig, BotConfig, createBotConfig, RunConfig } from "../config/BotConfig";
import { AgentBotSettings, IAssetBotContext } from "../fasset-bots/IAssetBotContext";
import { initWeb3 } from "../utils/web3";
import { requireEnv, toBN } from "../utils/helpers";
import * as dotenv from "dotenv";
import { readFileSync } from "fs";
import { time } from "@openzeppelin/test-helpers";
import chalk from 'chalk';
import { CollateralTokenClass } from "../fasset/AssetManagerTypes";
dotenv.config();

const RPC_URL: string = requireEnv('RPC_URL');
const OWNER_PRIVATE_KEY: string = requireEnv('OWNER_PRIVATE_KEY');
const RUN_CONFIG_PATH: string = requireEnv('RUN_CONFIG_PATH');
const DEFAULT_AGENT_SETTINGS_PATH: string = requireEnv('DEFAULT_AGENT_SETTINGS_PATH');

export class BotCliCommands {

    context!: IAssetBotContext;
    ownerAddress!: string;
    botConfig!: BotConfig;
    agentSettingsConfig!: AgentSettingsConfig;

    async initEnvironment(): Promise<void> {
        console.log(chalk.cyan('Initializing environment...'));
        const runConfig = JSON.parse(readFileSync(RUN_CONFIG_PATH).toString()) as RunConfig;
        const accounts = await initWeb3(RPC_URL, [OWNER_PRIVATE_KEY], null);
        this.agentSettingsConfig = JSON.parse(readFileSync(DEFAULT_AGENT_SETTINGS_PATH).toString()) as AgentSettingsConfig;
        this.botConfig = await createBotConfig(runConfig);
        this.ownerAddress = accounts[0];
        this.context = await createAssetContext(this.botConfig, this.botConfig.chains[0]);
        console.log(chalk.cyan('Environment successfully initialized.'));
    }

    async createAgentVault(): Promise<string | null> {
        const class1token = (await this.context.assetManager.getCollateralTokens()).find(token => {
            return token.tokenClass.toNumber() === CollateralTokenClass.POOL && token.ftsoSymbol === this.agentSettingsConfig.class1FtsoSymbol
        });
        if (!class1token) {
            console.error(`Invalid class 1 collateral token ${this.agentSettingsConfig.class1FtsoSymbol}`);
            return null;
        }
        const collateralToken = (await this.context.assetManager.getCollateralTokens()).find(token => {
            return token.tokenClass.toNumber() === CollateralTokenClass.POOL && token.ftsoSymbol === "NAT"
        });
        if (!collateralToken) {
            console.error(`Cannot find pool collateral token`);
            return null;
        }
        const agentBotSettings: AgentBotSettings = {
            class1CollateralToken: class1token.token,
            feeBIPS: toBN(this.agentSettingsConfig.feeBIPS),
            poolFeeShareBIPS: toBN(this.agentSettingsConfig.poolFeeShareBIPS),
            mintingClass1CollateralRatioBIPS: class1token.minCollateralRatioBIPS.muln(this.agentSettingsConfig.mintingClass1CollateralRatioConstant),
            mintingPoolCollateralRatioBIPS: collateralToken.minCollateralRatioBIPS.muln(this.agentSettingsConfig.mintingPoolCollateralRatioConstant),
            poolExitCollateralRatioBIPS: collateralToken.minCollateralRatioBIPS.muln(this.agentSettingsConfig.poolExitCollateralRatioConstant),
            buyFAssetByAgentFactorBIPS: toBN(this.agentSettingsConfig.buyFAssetByAgentFactorBIPS),
            poolTopupCollateralRatioBIPS: collateralToken.minCollateralRatioBIPS.muln(this.agentSettingsConfig.poolTopupCollateralRatioConstant),
            poolTopupTokenPriceFactorBIPS: toBN(this.agentSettingsConfig.poolTopupTokenPriceFactorBIPS)
        };
        const agentBot = await AgentBot.create(this.botConfig.orm.em, this.context, this.ownerAddress, agentBotSettings, this.botConfig.notifier);
        console.log(chalk.cyan(`Agent ${agentBot.agent.vaultAddress} was created.`));
        return agentBot.agent.vaultAddress;
    }

    async depositToVault(agentVault: string, amount: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.depositClass1Collateral(amount);
        console.log(chalk.cyan(`Deposit of ${amount} to agent ${agentVault} was successful.`));
    }

    async buyCollateralPoolTokens(agentVault: string, amount: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.buyCollateralPoolTokens(amount);
        console.log(chalk.cyan(`Buying ${amount} collateral pool tokens for agent ${agentVault} was successful.`));
    }

    async enterAvailableList(agentVault: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.makeAvailable();
        console.log(chalk.cyan(`Agent ${agentVault} ENTERED available list.`));
    }

    async exitAvailableList(agentVault: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.exitAvailable();
        console.log(chalk.cyan(`Agent ${agentVault} EXITED available list.`));
    }

    async withdrawFromVault(agentVault: string, amount: string): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        await agentBot.agent.announceClass1CollateralWithdrawal(amount);
        console.log(chalk.cyan(`Withdraw of ${amount} from agent ${agentVault} has been announced.`));
        agentEnt.waitingForWithdrawalTimestamp = (await time.latest()).toNumber();
        agentEnt.waitingForWithdrawalAmount = toBN(amount);
    }

    async selfClose(agentVault: string, amountUBA: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.selfClose(amountUBA);
        console.log(chalk.cyan(`Agent ${agentVault} self closed successfully.`));
    }

    async updateAgentSetting(agentVault: string, settingName: string, settingValue: string): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        await agentBot.agent.announceAgentSettingUpdate(settingName, settingValue);
        agentEnt.waitingForAgentSettingUpdateTimestamp = (await time.latest()).toNumber();
        agentEnt.waitingForAgentSettingUpdateName = settingName;
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
            case 'buyPoolCollateral': {
                const agentVaultBuyPool = args[3];
                const amountBuyPool = args[4];
                if (agentVaultBuyPool && amountBuyPool) {
                    await this.buyCollateralPoolTokens(agentVaultBuyPool, amountBuyPool);
                } else {
                    console.log("Missing arguments ", chalk.blue("<agentVault> <amount>"), " for command ", chalk.yellow("buyPoolCollateral"));
                }
                break;
            }
            case 'enter': {
                const agentVaultEnter = args[3];
                if (agentVaultEnter) {
                    await this.enterAvailableList(agentVaultEnter);
                } else {
                    console.log("Missing arguments ", chalk.blue("<agentVault>"), " for command ", chalk.yellow("enter"));
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
            case 'setAgentSetting': {
                const agentVaultAgentSetting = args[3];
                const agentSettingName = args[4];
                const agentSettingValue = args[5];
                if (agentVaultAgentSetting && agentSettingName && agentSettingValue) {
                    await this.updateAgentSetting(agentVaultAgentSetting, agentSettingName, agentSettingValue);
                } else {
                    console.log("Missing arguments ", chalk.blue("<agentVault>, <agentSettingName>, <agentSettingValue>"), " for command ", chalk.yellow("setAgentSetting"));
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
    console.log(chalk.yellow('  deposit'), "\t", chalk.blue('<agentVault> <amount>'), "\t\t\t", "deposit class1 collateral to agent vault from owner's address");
    console.log(chalk.yellow('  buyPoolCollateral'), "\t", chalk.blue('<agentVault> <amount>'), "\t\t\t", "deposit class1 collateral to agent vault from owner's address");
    console.log(chalk.yellow('  enter'), "\t", chalk.blue('<agentVault> <feeBips> <agentMinCrBips>'), "enter available agent's list");
    console.log(chalk.yellow('  exit'), "\t\t", chalk.blue('<agentVault>'), "\t\t\t\t", "exit available agent's list");
    console.log(chalk.yellow('  setAgentSetting'), "\t", chalk.blue('<agentVault> <agentSettingName> <agentSettingValue>'), "\t\t", "set agent's settings");
    console.log(chalk.yellow('  withdraw'), "\t", chalk.blue('<agentVault> <amount>'), "\t\t\t", "withdraw amount from agent vault to owner's address");
    console.log(chalk.yellow('  selfClose'), "\t", chalk.blue('<agentVault> <amountUBA>'), "\t\t", "self close agent vault with amountUBA of FAssets");
    console.log(chalk.yellow('  close'), "\t", chalk.blue('<agentVault>'), "\t\t\t\t", "close agent vault", "\n");
}