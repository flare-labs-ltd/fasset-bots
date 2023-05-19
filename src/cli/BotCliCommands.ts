import { FilterQuery } from "@mikro-orm/core";
import { AgentBot } from "../actors/AgentBot";
import { AgentEntity } from "../entities/agent";
import { createAssetContext } from "../config/create-asset-context";
import { AgentSettingsConfig, BotConfig, createAgentBotSettings, createBotConfig, RunConfig } from "../config/BotConfig";
import { AgentBotSettings, IAssetBotContext } from "../fasset-bots/IAssetBotContext";
import { initWeb3 } from "../utils/web3";
import { BN_ZERO, requireEnv, toBN } from "../utils/helpers";
import * as dotenv from "dotenv";
import { readFileSync } from "fs";
import chalk from 'chalk';
import { latestBlockTimestampBN } from "../utils/web3helpers";
import { getSourceName } from "../verification/sources/sources";
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
        const agentBotSettings: AgentBotSettings = await createAgentBotSettings(this.context);
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

    async announceExitAvailableList(agentVault: string): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        const exitAllowedAt = await agentBot.agent.announceExitAvailable();
        agentEnt.exitAvailableAllowedAtTimestamp = exitAllowedAt;
        console.log(chalk.cyan(`Agent ${agentVault} successfully announced EXIT available list.`));
    }

    async withdrawFromVault(agentVault: string, amount: string): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        const withdrawalAllowedAt = await agentBot.agent.announceClass1CollateralWithdrawal(amount);
        console.log(chalk.cyan(`Class1 ${amount} withdrawal from agent ${agentVault} has been announced.`));
        agentEnt.withdrawalAllowedAtTimestamp = withdrawalAllowedAt;
        agentEnt.withdrawalAllowedAtAmount = toBN(amount);
    }

    async withdrawPoolFees(agentVault: string, amount: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.withdrawPoolFees(amount);
        console.log(chalk.cyan(`Pool fees ${amount} have been successfully withdrawn from agent ${agentVault}.`));
    }

    async poolFeesBalance(agentVault: string): Promise<BN> {
        const { agentBot } = await this.getAgentBot(agentVault);
        const balance = await agentBot.agent.poolFeeBalance();
        console.log(chalk.cyan(`Agent ${agentVault} has following pool fees balance ${balance}.`));
        return balance;
    }

    async selfClose(agentVault: string, amountUBA: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.selfClose(amountUBA);
        console.log(chalk.cyan(`Agent ${agentVault} self closed successfully.`));
    }

    async updateAgentSetting(agentVault: string, settingName: string, settingValue: string): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        const validAt = await agentBot.agent.announceAgentSettingUpdate(settingName, settingValue);
        agentEnt.agentSettingUpdateValidAtTimestamp = validAt;
        agentEnt.agentSettingUpdateValidAtName = settingName;
    }

    async closeVault(agentVault: string): Promise<void> {
        const agentEnt = await this.botConfig.orm.em.getRepository(AgentEntity).findOneOrFail({ vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const agentInfo = await this.context.assetManager.getAgentInfo(agentVault);
        if (agentInfo.publiclyAvailable) {
            await this.announceExitAvailableList(agentVault);
        }
        agentEnt.waitingForDestructionCleanUp = true;
        await this.botConfig.orm.em.persist(agentEnt).flush();
    }

    async announceUnderlyingWithdrawal(agentVault: string): Promise<string> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        const announce = await agentBot.agent.announceUnderlyingWithdrawal();
        agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = await latestBlockTimestampBN();
        await this.botConfig.orm.em.persist(agentEnt).flush();
        console.log(chalk.cyan(`Announcement for underlying withdrawal for agent ${agentVault} can be performed with payment reference ${announce.paymentReference}.`));
        return announce.paymentReference;
    }

    async performUnderlyingWithdrawal(agentVault: string, amount: string, destinationAddress: string, paymentReference: string): Promise<string> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        const txHash = await agentBot.agent.performUnderlyingWithdrawal(paymentReference, amount, destinationAddress);
        agentEnt.underlyingWithdrawalConfirmTransaction = txHash;
        await this.botConfig.orm.em.persist(agentEnt).flush();
        console.log(chalk.cyan(`Underlying withdrawal for agent ${agentVault} was performed ${txHash}.`));
        return txHash;
    }

    async confirmUnderlyingWithdrawal(agentVault: string, txHash: string): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        if (agentEnt.underlyingWithdrawalAnnouncedAtTimestamp.gt(BN_ZERO)) {
            const announcedUnderlyingConfirmationMinSeconds = toBN((await this.context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds);
            const latestTimestamp = await latestBlockTimestampBN();
            if ((agentEnt.underlyingWithdrawalAnnouncedAtTimestamp.add(announcedUnderlyingConfirmationMinSeconds)).lt(latestTimestamp)) {
                await agentBot.agent.confirmUnderlyingWithdrawal(txHash);
                agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = BN_ZERO;
                agentEnt.underlyingWithdrawalConfirmTransaction = "";
                await this.botConfig.orm.em.persist(agentEnt).flush();
                console.log(chalk.cyan(`Underlying withdrawal announcement for agent ${agentVault} was cancelled.`));
            }
        } else {
            console.log(chalk.cyan(`No active underlying withdrawal announcement for agent ${agentVault}.`));
        }
    }

    async cancelUnderlyingWithdrawal(agentVault: string): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        if (agentEnt.underlyingWithdrawalAnnouncedAtTimestamp.gt(BN_ZERO)) {
            const announcedUnderlyingConfirmationMinSeconds = toBN((await this.context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds);
            const latestTimestamp = await latestBlockTimestampBN();
            if ((agentEnt.underlyingWithdrawalAnnouncedAtTimestamp.add(announcedUnderlyingConfirmationMinSeconds)).lt(latestTimestamp)) {
                await agentBot.agent.cancelUnderlyingWithdrawal();
                agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = BN_ZERO;
                await this.botConfig.orm.em.persist(agentEnt).flush();
                console.log(chalk.cyan(`Underlying withdrawal announcement for agent ${agentVault} was cancelled.`));
            }
        } else {
            console.log(chalk.cyan(`No active underlying withdrawal announcement for agent ${agentVault}.`));
        }

    }

    async listActiveAgents() {
        const query = this.botConfig.orm.em.createQueryBuilder(AgentEntity);
        const listOfAgents = await query.where({ active: true }).getResultList();
        for (const agent of listOfAgents) {
            console.log(`Vault: ${agent.vaultAddress}, Pool: ${agent.collateralPoolAddress}, Underlying: ${agent.underlyingAddress}, Chain ${getSourceName(agent.chainId)}`);
        }
    }

    async getAgentBot(agentVault: string): Promise<{ agentBot: AgentBot, agentEnt: AgentEntity }> {
        const agentEnt = await this.botConfig.orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(this.context, agentEnt, this.botConfig.notifier);
        return { agentBot, agentEnt };
    }

    async run(args: string[]): Promise<void> {
        try {
            switch (args[2]) {
                case 'create':
                    await this.createAgentVault();
                    break;
                case 'depositClass1': {
                    const agentVaultDeposit = args[3];
                    const amount = args[4];
                    if (agentVaultDeposit && amount) {
                        await this.depositToVault(agentVaultDeposit, amount);
                    } else {
                        console.log("Missing arguments ", chalk.blue("<agentVault> <amount>"), " for command ", chalk.yellow("depositClass1"));
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
                        await this.announceExitAvailableList(agentVaultExit);
                    } else {
                        console.log("Missing argument ", chalk.blue("<agentVault>"), " for command ", chalk.yellow("exit"));
                    }
                    break;
                }
                case 'updateAgentSetting': {
                    const agentVaultAgentSetting = args[3];
                    const agentSettingName = args[4];
                    const agentSettingValue = args[5];
                    if (agentVaultAgentSetting && agentSettingName && agentSettingValue) {
                        await this.updateAgentSetting(agentVaultAgentSetting, agentSettingName, agentSettingValue);
                    } else {
                        console.log("Missing arguments ", chalk.blue("<agentVault>, <agentSettingName>, <agentSettingValue>"), " for command ", chalk.yellow("updateAgentSetting"));
                    }
                    break;
                }
                case 'withdrawClass1': {
                    const agentVaultWithdrawClass1 = args[3];
                    const amountWithdrawClass1 = args[4];
                    if (agentVaultWithdrawClass1 && amountWithdrawClass1) {
                        await this.withdrawFromVault(agentVaultWithdrawClass1, amountWithdrawClass1);
                    } else {
                        console.log("Missing arguments ", chalk.blue("<agentVault>, <amount>"), " for command ", chalk.yellow("withdrawClass1"));
                    }
                    break;
                }
                case 'poolFeesBalance': {
                    const agentVaultPoolFeesBalance = args[3];
                    if (agentVaultPoolFeesBalance) {
                        await this.poolFeesBalance(agentVaultPoolFeesBalance);
                    } else {
                        console.log("Missing arguments ", chalk.blue("<agentVault>"), " for command ", chalk.yellow("poolFeesBalance"));
                    }
                    break;
                }
                case 'withdrawPoolFees': {
                    const agentVaultWithdraw = args[3];
                    const amountWithdraw = args[4];
                    if (agentVaultWithdraw && amountWithdraw) {
                        await this.withdrawPoolFees(agentVaultWithdraw, amountWithdraw);
                    } else {
                        console.log("Missing arguments ", chalk.blue("<agentVault>, <amount>"), " for command ", chalk.yellow("withdrawPoolFees"));
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
                case 'announceUnderlyingWithdrawal': {
                    const agentVaultAnnounceUnderlying = args[3];
                    if (agentVaultAnnounceUnderlying) {
                        await this.announceUnderlyingWithdrawal(agentVaultAnnounceUnderlying);
                    } else {
                        console.log("Missing arguments ", chalk.blue("<agentVault>"), " for command ", chalk.yellow("announceUnderlyingWithdrawal"));
                    }
                    break;
                }
                case 'performUnderlyingWithdrawal': {
                    const agentPerformUnderlying = args[3];
                    const amount = args[4];
                    const destinationAddress = args[5];
                    const paymentReference = args[6];
                    if (agentPerformUnderlying && amount && destinationAddress && paymentReference) {
                        await this.performUnderlyingWithdrawal(agentPerformUnderlying, amount, destinationAddress, paymentReference);
                    } else {
                        console.log("Missing argument ", chalk.blue("<agentVault> <amount> <destinationAddress> <paymentReference>"), " for command ", chalk.yellow("performUnderlyingWithdrawal"));
                    }
                    break;
                }
                case 'confirmUnderlyingWithdrawal': {
                    const agentConfirmUnderlying = args[3];
                    const txHashConfirmUnderlying = args[4];
                    if (agentConfirmUnderlying) {
                        await this.confirmUnderlyingWithdrawal(agentConfirmUnderlying, txHashConfirmUnderlying);
                    } else {
                        console.log("Missing argument ", chalk.blue("<agentVault> <transactionHash>"), " for command ", chalk.yellow("confirmUnderlyingWithdrawal"));
                    }
                    break;
                }
                case 'cancelUnderlyingWithdrawal': {
                    const agentConfirmUnderlying = args[3];
                    if (agentConfirmUnderlying) {
                        await this.cancelUnderlyingWithdrawal(agentConfirmUnderlying);
                    } else {
                        console.log("Missing argument ", chalk.blue("<agentVault>"), " for command ", chalk.yellow("cancelUnderlyingWithdrawal"));
                    }
                    break;
                }
                case 'listAgents': {
                    await this.listActiveAgents();
                    break;
                }
                default:
                    listUsageAndCommands();
            }
        } catch (error) {
            console.error("Command could not be executed ", error);
        }
    }
}

export function listUsageAndCommands() {
    console.log("\n ", 'Usage: ' + chalk.green('fasset-bots-cli') + ' ' + chalk.yellow('[command]') + ' ' + chalk.blue('<arg>') + '', "\n");
    console.log('  Available commands:', "\n");
    console.log(chalk.yellow('  create '), "create new agent vault");
    console.log(chalk.yellow('  depositClass1 '), chalk.blue('<agentVault> <amount> '), "deposit class1 collateral to agent vault from owner's address");
    console.log(chalk.yellow('  buyPoolCollateral '), chalk.blue('<agentVault> <amount> '), "add pool collateral and agent pool tokens");
    console.log(chalk.yellow('  enter '), chalk.blue('<agentVault> '), "enter available agent's list");
    console.log(chalk.yellow('  exit '), chalk.blue('<agentVault> '), "exit available agent's list");
    console.log(chalk.yellow('  updateAgentSetting '), chalk.blue('<agentVault> <agentSettingName> <agentSettingValue> '), "set agent's settings");
    console.log(chalk.yellow('  withdrawClass1 '), chalk.blue('<agentVault> <amount> '), "withdraw amount from agent vault to owner's address");
    console.log(chalk.yellow('  withdrawPoolFees '), chalk.blue('<agentVault> <amount> '), "withdraw pool fees from pool to owner's address");
    console.log(chalk.yellow('  poolFeesBalance '), chalk.blue('<agentVault> '), "pool fees balance of agent");
    console.log(chalk.yellow('  selfClose '), chalk.blue('<agentVault> <amountUBA> '), "self close agent vault with amountUBA of FAssets");
    console.log(chalk.yellow('  close '), chalk.blue('<agentVault> '), "close agent vault", "\n");
    console.log(chalk.yellow('  announceUnderlyingWithdrawal '), chalk.blue('<agentVault> '), "announce underlying withdrawal and get needed payment reference");
    console.log(chalk.yellow('  performUnderlyingWithdrawal '), chalk.blue('<agentVault> <amount> <destinationAddress> <paymentReference> '), "perform underlying withdrawal and get needed transaction hash");
    console.log(chalk.yellow('  confirmUnderlyingWithdrawal '), chalk.blue('<agentVault> <transactionHash> '), "confirm underlying withdrawal with transaction hash");
    console.log(chalk.yellow('  cancelUnderlyingWithdrawal '), chalk.blue('<agentVault> '), "cancel underlying withdrawal announcement");
    console.log(chalk.yellow('  listAgents '), "list active agent from persistent state");
}