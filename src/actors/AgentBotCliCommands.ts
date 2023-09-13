/* eslint-disable @typescript-eslint/no-non-null-assertion */
import "dotenv/config";

import { FilterQuery } from "@mikro-orm/core";
import { AgentBot } from "./AgentBot";
import { AgentEntity } from "../entities/agent";
import { createAssetContext } from "../config/create-asset-context";
import { BotConfig, createAgentBotDefaultSettings, createBotConfig, BotConfigFile } from "../config/BotConfig";
import { AgentBotDefaultSettings, IAssetAgentBotContext } from "../fasset-bots/IAssetBotContext";
import { artifacts, initWeb3 } from "../utils/web3";
import { BN_ZERO, CommandLineError, requireEnv, toBN } from "../utils/helpers";
import { readFileSync } from "fs";
import chalk from "chalk";
import { latestBlockTimestampBN } from "../utils/web3helpers";
import { getSourceName } from "../verification/sources/sources";
import { Agent } from "../fasset/Agent";
import { logger } from "../utils/logger";
import { ChainInfo } from "../fasset/ChainInfo";

const RUN_CONFIG_PATH: string = requireEnv("RUN_CONFIG_PATH");
const CollateralPool = artifacts.require("CollateralPool");

export class BotCliCommands {
    context!: IAssetAgentBotContext;
    ownerAddress!: string;
    botConfig!: BotConfig;
    agentSettingsPath!: string;
    BotFAssetInfo!: ChainInfo;

    static async create(fAssetSymbol: string, runConfigFile: string = RUN_CONFIG_PATH) {
        const bot = new BotCliCommands();
        await bot.initEnvironment(fAssetSymbol, runConfigFile);
        return bot;
    }

    /**
     * Initializes asset context from AgentBotRunConfig
     */
    async initEnvironment(fAssetSymbol: string, runConfigFile: string = RUN_CONFIG_PATH): Promise<void> {
        logger.info(`Owner ${requireEnv("OWNER_ADDRESS")} started to initialize cli environment.`);
        console.log(chalk.cyan("Initializing environment..."));
        const runConfig = JSON.parse(readFileSync(runConfigFile).toString()) as BotConfigFile;
        // check arguments
        if (!runConfig.defaultAgentSettingsPath || !runConfig.ormOptions) {
            logger.error(`Owner ${requireEnv("OWNER_ADDRESS")} is missing defaultAgentSettingsPath or ormOptions in config`);
            throw new Error("Missing defaultAgentSettingsPath or ormOptions in config");
        }
        // init web3 and accounts
        this.ownerAddress = requireEnv("OWNER_ADDRESS");
        const nativePrivateKey = requireEnv("OWNER_PRIVATE_KEY");
        const accounts = await initWeb3(runConfig.rpcUrl, [nativePrivateKey], null);
        /* istanbul ignore next */
        if (this.ownerAddress !== accounts[0]) {
            logger.error(`Owner ${requireEnv("OWNER_ADDRESS")} has invalid address/private key pair.`);
            throw new Error("Invalid address/private key pair");
        }
        // create config
        this.agentSettingsPath = runConfig.defaultAgentSettingsPath;
        this.botConfig = await createBotConfig(runConfig, this.ownerAddress);
        // create context
        const chainConfig = this.botConfig.fAssets.find((cc) => cc.fAssetSymbol === fAssetSymbol);
        if (chainConfig == null) {
            logger.error(`Owner ${requireEnv("OWNER_ADDRESS")} has invalid FAsset symbol.`);
            throw new CommandLineError("Invalid FAsset symbol");
        }
        this.BotFAssetInfo = chainConfig.chainInfo;
        this.context = await createAssetContext(this.botConfig, chainConfig);
        // create underlying wallet key
        const underlyingAddress = requireEnv("OWNER_UNDERLYING_ADDRESS");
        const underlyingPrivateKey = requireEnv("OWNER_UNDERLYING_PRIVATE_KEY");
        await this.context.wallet.addExistingAccount(underlyingAddress, underlyingPrivateKey);
        console.log(chalk.cyan("Environment successfully initialized."));
        logger.info(`Owner ${requireEnv("OWNER_ADDRESS")} successfully finished initializing cli environment.`);
    }

    /**
     * Creates agent bot.
     */
    async createAgentVault(): Promise<Agent | null> {
        try {
        const agentBotSettings: AgentBotDefaultSettings = await createAgentBotDefaultSettings(this.context, this.agentSettingsPath);
        const agentBot = await AgentBot.create(this.botConfig.orm!.em, this.context, this.ownerAddress, agentBotSettings, this.botConfig.notifier!);
        this.botConfig.notifier!.sendAgentCreated(agentBot.agent.vaultAddress);
        return agentBot.agent;
        } catch (error) {
            console.log(`Owner ${requireEnv("OWNER_ADDRESS")} couldn't create agent.`);
    }
        return null;
    }

    /**
     * Deposits class 1 collateral to agent's vault from owner.
     */
    async depositToVault(agentVault: string, amount: string): Promise<void> {
        logger.info(`Agent's ${agentVault} owner ${this.ownerAddress} is starting vault collateral deposit ${amount}.`);
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.depositVaultCollateral(amount);
        this.botConfig.notifier!.sendVaultCollateralDeposit(agentVault, amount);
        logger.info(`Agent's ${agentVault} owner ${this.ownerAddress} deposited vault collateral ${amount}.`);
    }

    /**
     * Buys collateral pool tokens for agent.
     */
    async buyCollateralPoolTokens(agentVault: string, amount: string): Promise<void> {
        logger.info(`Agent's ${agentVault} owner ${this.ownerAddress} is starting to buy collateral pool tokens ${amount}.`);
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.buyCollateralPoolTokens(amount);
        this.botConfig.notifier!.sendBuyCollateralPoolTokens(agentVault, amount);
        logger.info(`Agent's ${agentVault} owner ${this.ownerAddress} bought collateral pool tokens ${amount}.`);
    }

    /**
     * Enters agent to available list, so agent can be minted against.
     */
    async enterAvailableList(agentVault: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.makeAvailable();
        this.botConfig.notifier!.sendAgentEnteredAvailable(agentVault);
        logger.info(`Agent ${agentVault} entered available list.`);
    }

    /**
     * Announces agent's exit from available list. It marks in persistent state that exit from available list
     * has started and it is then handled by method 'handleAgentsWaitingsAndCleanUp' in AgentBot.ts.
     */
    async announceExitAvailableList(agentVault: string): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        const exitAllowedAt = await agentBot.agent.announceExitAvailable();
        agentEnt.exitAvailableAllowedAtTimestamp = exitAllowedAt;
        this.botConfig.notifier!.sendAgentAnnouncedExitAvailable(agentVault);
        logger.info(`Agent ${agentVault} announced exit available list at ${exitAllowedAt.toString()}.`);
    }

    /**
     * Announces agent's withdrawal of class 1. It marks in persistent state that withdrawal of class 1
     * has started and it is then handled by method 'handleAgentsWaitingsAndCleanUp' in AgentBot.ts.
     */
    async withdrawFromVault(agentVault: string, amount: string): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        const withdrawalAllowedAt = await agentBot.agent.announceVaultCollateralWithdrawal(amount);
        this.botConfig.notifier!.sendWithdrawVaultCollateralAnnouncement(agentVault, amount);
        agentEnt.withdrawalAllowedAtTimestamp = withdrawalAllowedAt;
        agentEnt.withdrawalAllowedAtAmount = amount;
        logger.info(`Agent ${agentVault} announced vault collateral withdrawal ${amount} at ${withdrawalAllowedAt.toString()}.`);
    }

    /**
     * Withdraws agent's pool fees.
     */
    async withdrawPoolFees(agentVault: string, amount: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.withdrawPoolFees(amount);
        this.botConfig.notifier!.sendWithdrawPoolFees(agentVault, amount);
        logger.info(`Agent ${agentVault} withdrew pool fees ${amount}.`);
    }

    /**
     * Returns agent's pool fee balance.
     */
    async poolFeesBalance(agentVault: string): Promise<BN> {
        const { agentBot } = await this.getAgentBot(agentVault);
        const balance = await agentBot.agent.poolFeeBalance();
        this.botConfig.notifier!.sendBalancePoolFees(agentVault, balance.toString());
        logger.info(`Agent ${agentVault} has pool fee ${balance.toString()}.`);
        return balance;
    }

    /**
     * Starts agent's self closing process.
     */
    async selfClose(agentVault: string, amountUBA: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.selfClose(amountUBA);
        this.botConfig.notifier!.sendSelfClose(agentVault);
        logger.info(`Agent ${agentVault} self closed vault.`);
    }

    /**
     * Announces agent's settings update. It marks in persistent state that agent's settings update
     * has started and it is then handled by method 'handleAgentsWaitingsAndCleanUp' in AgentBot.ts.
     */
    async updateAgentSetting(agentVault: string, settingName: string, settingValue: string): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        const validAt = await agentBot.agent.announceAgentSettingUpdate(settingName, settingValue);
        agentEnt.agentSettingUpdateValidAtTimestamp = validAt;
        agentEnt.agentSettingUpdateValidAtName = settingName;
        logger.info(`Agent ${agentVault} announced agent settings update at ${validAt.toString()} for ${settingName}.`);
        console.log(`Agent ${agentVault} announced agent settings update at ${validAt.toString()} for ${settingName}.`);
    }

    /**
     * Starts agent's close vault process. Firstly, it exits available list if necessary.
     * Lastly it marks in persistent state that close vault process has started and it is then
     * handled by method 'handleAgentsWaitingsAndCleanUp' in AgentBot.ts.
     */
    async closeVault(agentVault: string): Promise<void> {
        const agentEnt = await this.botConfig.orm!.em.getRepository(AgentEntity).findOneOrFail({ vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const agentInfo = await this.context.assetManager.getAgentInfo(agentVault);
        if (agentInfo.publiclyAvailable) {
            await this.announceExitAvailableList(agentVault);
        }
        agentEnt.waitingForDestructionCleanUp = true;
        await this.botConfig.orm!.em.persist(agentEnt).flush();
        logger.info(`Agent ${agentVault} is waiting for destruction clean up before destroying.`);
        console.log(`Agent ${agentVault} is waiting for destruction clean up before destroying.`);
    }

    /**
     * Announces agent's underlying withdrawal. Firstly, it checks if there is any active withdrawal.
     * Lastly, it marks in persistent state that underlying withdrawal has started and it is then
     * handled by method 'handleAgentsWaitingsAndCleanUp' in AgentBot.ts.
     */
    async announceUnderlyingWithdrawal(agentVault: string): Promise<string | null> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        if (!toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).isZero()) {
            this.botConfig.notifier!.sendActiveWithdrawal(agentVault);
            logger.info(
                `Agent ${agentVault} already has an active underlying withdrawal announcement at ${agentEnt.underlyingWithdrawalAnnouncedAtTimestamp.toString()}.`
            );
            return null;
        }
        const announce = await agentBot.agent.announceUnderlyingWithdrawal();
        agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = await latestBlockTimestampBN();
        await this.botConfig.orm!.em.persist(agentEnt).flush();
        this.botConfig.notifier!.sendAnnounceUnderlyingWithdrawal(agentVault, announce.paymentReference);
        logger.info(
            `Agent ${agentVault} announced underlying withdrawal at ${agentEnt.underlyingWithdrawalAnnouncedAtTimestamp.toString()} with reference ${
                announce.paymentReference
            }.`
        );
        return announce.paymentReference;
    }

    /**
     * Performs agent's underlying withdrawal.
     */
    async performUnderlyingWithdrawal(agentVault: string, amount: string, destinationAddress: string, paymentReference: string): Promise<string> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        const txHash = await agentBot.agent.performUnderlyingWithdrawal(paymentReference, amount, destinationAddress);
        agentEnt.underlyingWithdrawalConfirmTransaction = txHash;
        await this.botConfig.orm!.em.persist(agentEnt).flush();
        this.botConfig.notifier!.sendUnderlyingWithdrawalPerformed(agentVault, txHash);
        logger.info(
            `Agent ${agentVault} performed underlying withdrawal ${amount} to ${destinationAddress} with reference ${paymentReference} and txHash ${txHash}.`
        );
        return txHash;
    }

    /**
     * Confirms agent's underlying withdrawal, if already allowed. Otherwise it marks in persistent state that confirmation
     * of underlying withdrawal has started and it is then handled by method 'handleAgentsWaitingsAndCleanUp' in AgentBot.ts.
     */
    async confirmUnderlyingWithdrawal(agentVault: string, txHash: string): Promise<void> {
        logger.info(`Agent ${agentVault} is waiting for confirming underlying withdrawal.`);
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        if (toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).gt(BN_ZERO)) {
            const announcedUnderlyingConfirmationMinSeconds = toBN((await this.context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds);
            const latestTimestamp = await latestBlockTimestampBN();
            if (toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).add(announcedUnderlyingConfirmationMinSeconds).lt(latestTimestamp)) {
                await agentBot.agent.confirmUnderlyingWithdrawal(txHash);
                logger.info(`Agent ${agentVault} confirmed underlying withdrawal of tx ${agentEnt.underlyingWithdrawalConfirmTransaction}.`);
                agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = BN_ZERO;
                agentEnt.underlyingWithdrawalConfirmTransaction = "";
                await this.botConfig.orm!.em.persist(agentEnt).flush();
                this.botConfig.notifier!.sendConfirmWithdrawUnderlying(agentVault);
            } else {
                logger.info(
                    `Agent ${agentVault} cannot yet confirm underlying withdrawal. Allowed at ${toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp)
                        .add(announcedUnderlyingConfirmationMinSeconds)
                        .toString()}. Current ${latestTimestamp.toString()}.`
                );
                console.log(
                    `Agent ${agentVault} cannot yet confirm underlying withdrawal. Allowed at ${toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp)
                    .add(announcedUnderlyingConfirmationMinSeconds)
                        .toString()}. Current ${latestTimestamp.toString()}.`
                );
            }
        } else {
            this.botConfig.notifier!.sendNoActiveWithdrawal(agentVault);
            logger.info(`Agent ${agentVault} has no active underlying withdrawal announcement.`);
        }
    }

    async cancelUnderlyingWithdrawal(agentVault: string): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        if (toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).gt(BN_ZERO)) {
            logger.info(`Agent ${agentVault} is waiting for canceling underlying withdrawal.`);
            console.log(`Agent ${agentVault} is waiting for canceling underlying withdrawal.`);
            const announcedUnderlyingConfirmationMinSeconds = toBN((await this.context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds);
            const latestTimestamp = await latestBlockTimestampBN();
            if (toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).add(announcedUnderlyingConfirmationMinSeconds).lt(latestTimestamp)) {
                await agentBot.agent.cancelUnderlyingWithdrawal();
                logger.info(`Agent ${agentVault} canceled underlying withdrawal of tx ${agentEnt.underlyingWithdrawalConfirmTransaction}.`);
                agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = BN_ZERO;
                await this.botConfig.orm!.em.persist(agentEnt).flush();
                this.botConfig.notifier!.sendCancelWithdrawUnderlying(agentVault);
            } else {
                agentEnt.underlyingWithdrawalWaitingForCancelation = true;
                await this.botConfig.orm!.em.persist(agentEnt).flush();
                logger.info(
                    `Agent ${agentVault} cannot yet cancel underlying withdrawal. Allowed at ${toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp)
                        .add(announcedUnderlyingConfirmationMinSeconds)
                        .toString()}. Current ${latestTimestamp.toString()}.`
                );
                console.log(
                    `Agent ${agentVault} cannot yet cancel underlying withdrawal. Allowed at ${toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp)
                        .add(announcedUnderlyingConfirmationMinSeconds)
                        .toString()}. Current ${latestTimestamp.toString()}.`
                );
            }
        } else {
            this.botConfig.notifier!.sendNoActiveWithdrawal(agentVault);
            logger.info(`Agent ${agentVault} has no active underlying withdrawal announcement.`);
        }
    }

    /**
     * Lists active agents in owner's local db.
     */
    async listActiveAgents() {
        const query = this.botConfig.orm!.em.createQueryBuilder(AgentEntity);
        const listOfAgents = await query.where({ active: true }).getResultList();
        for (const agent of listOfAgents) {
            console.log(
                `Vault: ${agent.vaultAddress}, Pool: ${agent.collateralPoolAddress}, Underlying: ${agent.underlyingAddress}, Chain: ${getSourceName(
                    agent.chainId
                )}`
            );
        }
    }

    /**
     * Returns AgentBot and AgentBot entity from agent's vault address.
     */
    async getAgentBot(agentVault: string): Promise<{ agentBot: AgentBot; agentEnt: AgentEntity }> {
        const agentEnt = await this.botConfig.orm!.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(this.context, agentEnt, this.botConfig.notifier!);
        return { agentBot, agentEnt };
    }

    /**
     * Delegates pool collateral.
     */
    async delegatePoolCollateral(agentVault: string, delegatesString: string, amountsString: string) {
        const delegates = delegatesString.split(",");
        const amounts = amountsString.split(",");
        const agentEnt = await this.botConfig.orm!.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const collateralPool = await CollateralPool.at(agentEnt.collateralPoolAddress);
        await collateralPool.delegate(delegates, amounts, { from: agentEnt.ownerAddress });
        this.botConfig.notifier!.sendDelegatePoolCollateral(agentVault, collateralPool.address, delegates, amounts);
        logger.info(`Agent ${agentVault} delegated pool collateral to ${delegates} with amounts ${amounts}.`);
    }

    /**
     * Undelegates pool collateral.
     */
    async undelegatePoolCollateral(agentVault: string) {
        const agentEnt = await this.botConfig.orm!.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const collateralPool = await CollateralPool.at(agentEnt.collateralPoolAddress);
        await collateralPool.undelegateAll({ from: agentEnt.ownerAddress });
        this.botConfig.notifier!.sendUndelegatePoolCollateral(agentVault, collateralPool.address);
        logger.info(`Agent ${agentVault} undelegated all pool collateral.`);
    }
}
