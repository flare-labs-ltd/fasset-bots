/* eslint-disable @typescript-eslint/no-non-null-assertion */
import "dotenv/config";

import { FilterQuery } from "@mikro-orm/core";
import { AgentBot } from "./AgentBot";
import { AgentEntity } from "../entities/agent";
import { createAssetContext } from "../config/create-asset-context";
import { BotConfig, createAgentBotDefaultSettings, createBotConfig, loadAgentConfigFile } from "../config/BotConfig";
import { AgentBotDefaultSettings, IAssetAgentBotContext } from "../fasset-bots/IAssetBotContext";
import { artifacts, authenticatedHttpProvider, initWeb3 } from "../utils/web3";
import { BN_ZERO, CommandLineError, requireEnv, toBN } from "../utils/helpers";
import { requireSecret } from "../config/secrets";
import chalk from "chalk";
import { latestBlockTimestampBN } from "../utils/web3helpers";
import { Agent } from "../fasset/Agent";
import { logger } from "../utils/logger";
import { ChainInfo } from "../fasset/ChainInfo";
import { DBWalletKeys } from "../underlying-chain/WalletKeys";
import { decodeAttestationName } from "@flarenetwork/state-connector-protocol";
import { getSecrets } from "../config/secrets";
import { getAgentSettings, printAgentInfo } from "../utils/fasset-helpers";
import { AgentSettings } from "../fasset/AssetManagerTypes";

const RUN_CONFIG_PATH: string = requireEnv("RUN_CONFIG_PATH");
const CollateralPool = artifacts.require("CollateralPool");
const IERC20 = artifacts.require("IERC20Metadata");

export class BotCliCommands {
    context!: IAssetAgentBotContext;
    ownerAddress!: string;
    botConfig!: BotConfig;
    agentSettingsPath!: string;
    BotFAssetInfo!: ChainInfo;

    /**
     *
     * Creates instance of BotCliCommands.
     * @param fAssetSymbol symbol for the fasset
     * @param runConfigFile path to configuration file
     * @returns instance of BotCliCommands class
     */
    static async create(fAssetSymbol: string, runConfigFile: string = RUN_CONFIG_PATH) {
        const bot = new BotCliCommands();
        await bot.initEnvironment(fAssetSymbol, runConfigFile);
        return bot;
    }

    /**
     * Initializes asset context from AgentBotRunConfig
     * @param fAssetSymbol symbol for the fasset
     * @param runConfigFile path to configuration file
     */
    async initEnvironment(fAssetSymbol: string, runConfigFile: string = RUN_CONFIG_PATH): Promise<void> {
        logger.info(`Owner ${requireSecret("owner.native_address")} started to initialize cli environment.`);
        console.log(chalk.cyan("Initializing environment..."));
        const runConfig = loadAgentConfigFile(runConfigFile, `Owner ${requireSecret("owner.native_address")}`);
        // init web3 and accounts
        this.ownerAddress = requireSecret("owner.native_address");
        const nativePrivateKey = requireSecret("owner.native_private_key");
        const accounts = await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), [nativePrivateKey], null);
        /* istanbul ignore next */
        if (this.ownerAddress !== accounts[0]) {
            logger.error(`Owner ${requireSecret("owner.native_address")} has invalid address/private key pair.`);
            throw new Error("Invalid address/private key pair");
        }
        // create config
        this.agentSettingsPath = runConfig.defaultAgentSettingsPath;
        this.botConfig = await createBotConfig(runConfig, this.ownerAddress);
        // create context
        const chainConfig = this.botConfig.fAssets.find((cc) => cc.fAssetSymbol === fAssetSymbol);
        if (chainConfig == null) {
            logger.error(`Owner ${requireSecret("owner.native_address")} has invalid FAsset symbol ${fAssetSymbol}.`);
            throw new CommandLineError(`Invalid FAsset symbol ${fAssetSymbol}`);
        }
        this.BotFAssetInfo = chainConfig.chainInfo;
        this.context = await createAssetContext(this.botConfig, chainConfig);
        // create underlying wallet key
        const underlyingAddress = requireSecret("owner.underlying_address");
        const underlyingPrivateKey = requireSecret("owner.underlying_private_key");
        await this.context.wallet.addExistingAccount(underlyingAddress, underlyingPrivateKey);
        console.log(chalk.cyan("Environment successfully initialized."));
        logger.info(`Owner ${requireSecret("owner.native_address")} successfully finished initializing cli environment.`);
    }

    /**
     * Creates instance of Agent.
     * @param poolTokenSuffix
     */
    async createAgentVault(poolTokenSuffix: string): Promise<Agent | null> {
        try {
            const agentBotSettings: AgentBotDefaultSettings = await createAgentBotDefaultSettings(this.context, this.agentSettingsPath, poolTokenSuffix);
            const agentBot = await AgentBot.create(this.botConfig.orm!.em, this.context, this.ownerAddress, agentBotSettings, this.botConfig.notifier!);
            this.botConfig.notifier!.sendAgentCreated(agentBot.agent.vaultAddress);
            return agentBot.agent;
        } catch (error) {
            console.log(`Owner ${requireSecret("owner.native_address")} couldn't create agent.`);
            logger.error(`Owner ${requireSecret("owner.native_address")} couldn't create agent: ${error}`);
        }
        return null;
    }

    /**
     * Deposits class 1 collateral to agent's vault from owner.
     * @param agentVault agent's vault address
     * @param amount amount to be deposited
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
     * @param agentVault agent's vault address
     * @param amount add pool tokens in that correspond to amount of nat
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
     * @param agentVault agent's vault address
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
     * @param agentVault agent's vault address
     */
    async announceExitAvailableList(agentVault: string): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        const exitAllowedAt = await agentBot.agent.announceExitAvailable();
        agentEnt.exitAvailableAllowedAtTimestamp = exitAllowedAt;
        await this.botConfig.orm!.em.persistAndFlush(agentEnt);
        this.botConfig.notifier!.sendAgentAnnouncedExitAvailable(agentVault);
        logger.info(`Agent ${agentVault} announced exit available list at ${exitAllowedAt.toString()}.`);
    }

    /**
     * Exit agent's available list.
     * @param agentVault agent's vault address
     */
    async exitAvailableList(agentVault: string): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        if (toBN(agentEnt.exitAvailableAllowedAtTimestamp).gt(BN_ZERO)) {
            // agent can exit available
            await agentBot.exitAvailable(agentEnt);
        } else {
            logger.info(`Agent ${agentVault} cannot yet exit available list, allowed at ${toBN(agentEnt.exitAvailableAllowedAtTimestamp).toString()}.`);
        }
    }

    /**
     * Announces agent's withdrawal of class 1. It marks in persistent state that withdrawal of class 1
     * has started and it is then handled by method 'handleAgentsWaitingsAndCleanUp' in AgentBot.ts.
     * @param agentVault agent's vault address
     * @param amount amount to be withdrawn
     */
    async withdrawFromVault(agentVault: string, amount: string): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        const withdrawalAllowedAt = await agentBot.agent.announceVaultCollateralWithdrawal(amount);
        this.botConfig.notifier!.sendWithdrawVaultCollateralAnnouncement(agentVault, amount);
        agentEnt.withdrawalAllowedAtTimestamp = withdrawalAllowedAt;
        agentEnt.withdrawalAllowedAtAmount = amount;
        await this.botConfig.orm!.em.persistAndFlush(agentEnt);
        logger.info(`Agent ${agentVault} announced vault collateral withdrawal ${amount} at ${withdrawalAllowedAt.toString()}.`);
    }

    /**
     * Withdraws agent's pool fees.
     * @param agentVault agent's vault address
     * @param amount amount to be withdrawn
     */
    async withdrawPoolFees(agentVault: string, amount: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.withdrawPoolFees(amount);
        this.botConfig.notifier!.sendWithdrawPoolFees(agentVault, amount);
        logger.info(`Agent ${agentVault} withdrew pool fees ${amount}.`);
    }

    /**
     * Returns agent's pool fee balance.
     * @param agentVault agent's vault address
     */
    async poolFeesBalance(agentVault: string): Promise<string> {
        const { agentBot } = await this.getAgentBot(agentVault);
        const balance = await agentBot.agent.poolFeeBalance();
        this.botConfig.notifier!.sendBalancePoolFees(agentVault, balance.toString());
        logger.info(`Agent ${agentVault} has pool fee ${balance.toString()}.`);
        return balance.toString();
    }

    /**
     * Starts agent's self closing process.
     * @param agentVault agent's vault address
     * @param amountUBa amount of fassets to self-close
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
     * @param agentVault agent's vault address
     * @param settingName
     * @param settingValue
     */
    async updateAgentSetting(agentVault: string, settingName: string, settingValue: string): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        const validAt = await agentBot.agent.announceAgentSettingUpdate(settingName, settingValue);
        switch (settingName) {
            case "feeBIPS": {
                agentEnt.agentSettingUpdateValidAtFeeBIPS = validAt;
                break;
            }
            case "poolFeeShareBIPS": {
                agentEnt.agentSettingUpdateValidAtPoolFeeShareBIPS = validAt;
                break;
            }
            case "mintingVaultCollateralRatioBIPS": {
                agentEnt.agentSettingUpdateValidAtMintingVaultCrBIPS = validAt;
                break;
            }
            case "mintingPoolCollateralRatioBIPS": {
                agentEnt.agentSettingUpdateValidAtMintingPoolCrBIPS = validAt;
                break;
            }
            case "buyFAssetByAgentFactorBIPS": {
                agentEnt.agentSettingUpdateValidAtBuyFAssetByAgentFactorBIPS = validAt;
                break;
            }
            case "poolExitCollateralRatioBIPS": {
                agentEnt.agentSettingUpdateValidAtPoolExitCrBIPS = validAt;
                break;
            }
            case "poolTopupCollateralRatioBIPS": {
                agentEnt.agentSettingUpdateValidAtPoolTopupCrBIPS = validAt;
                break;
            }
            case "poolTopupTokenPriceFactorBIPS": {
                agentEnt.agentSettingUpdateValidAtPoolTopupTokenPriceFactorBIPS = validAt;
                break;
            }
        }
        await this.botConfig.orm!.em.persistAndFlush(agentEnt);
        logger.info(`Agent ${agentVault} announced agent settings update at ${validAt.toString()} for ${settingName}.`);
        console.log(`Agent ${agentVault} announced agent settings update at ${validAt.toString()} for ${settingName}.`);
    }

    /**
     * Starts agent's close vault process. Firstly, it exits available list if necessary.
     * Lastly it marks in persistent state that close vault process has started and it is then
     * handled by method 'handleAgentsWaitingsAndCleanUp' in AgentBot.ts.
     * @param agentVault agent's vault address
     */
    async closeVault(agentVault: string): Promise<void> {
        const agentEnt = await this.botConfig.orm!.em.getRepository(AgentEntity).findOneOrFail({ vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const agentInfo = await this.context.assetManager.getAgentInfo(agentVault);
        if (agentInfo.publiclyAvailable) {
            await this.announceExitAvailableList(agentVault);
        }
        agentEnt.waitingForDestructionCleanUp = true;
        await this.botConfig.orm!.em.persistAndFlush(agentEnt);
        logger.info(`Agent ${agentVault} is waiting for destruction clean up before destroying.`);
        console.log(`Agent ${agentVault} is waiting for destruction clean up before destroying.`);
    }

    /**
     * Announces agent's underlying withdrawal. Firstly, it checks if there is any active withdrawal.
     * Lastly, it marks in persistent state that underlying withdrawal has started and it is then
     * handled by method 'handleAgentsWaitingsAndCleanUp' in AgentBot.ts.
     * @param agentVault agent's vault address
     * @returns payment reference needed to make legal withdrawal or null (e.g. underlying withdrawal is already announced)
     */
    async announceUnderlyingWithdrawal(agentVault: string): Promise<string | null> {
        try {
            const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
            const announce = await agentBot.agent.announceUnderlyingWithdrawal();
            agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = await latestBlockTimestampBN();
            await this.botConfig.orm!.em.persistAndFlush(agentEnt);
            this.botConfig.notifier!.sendAnnounceUnderlyingWithdrawal(agentVault, announce.paymentReference);
            logger.info(
                `Agent ${agentVault} announced underlying withdrawal at ${agentEnt.underlyingWithdrawalAnnouncedAtTimestamp.toString()} with reference ${
                    announce.paymentReference
                }.`
            );
            return announce.paymentReference;
        } catch (error) {
            console.error(error);
            return null;
        }
    }

    /**
     * Performs agent's underlying withdrawal.
     * @param agentVault agent's vault address
     * @param amount amount to be transferred
     * @param destinationAddress underlying destination address
     * @param paymentReference announced underlying payment reference
     * @returns transaction hash
     */
    async performUnderlyingWithdrawal(agentVault: string, amount: string, destinationAddress: string, paymentReference: string): Promise<string> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        const txHash = await agentBot.agent.performUnderlyingWithdrawal(paymentReference, amount, destinationAddress);
        agentEnt.underlyingWithdrawalConfirmTransaction = txHash;
        await this.botConfig.orm!.em.persistAndFlush(agentEnt);
        this.botConfig.notifier!.sendUnderlyingWithdrawalPerformed(agentVault, txHash);
        logger.info(
            `Agent ${agentVault} performed underlying withdrawal ${amount} to ${destinationAddress} with reference ${paymentReference} and txHash ${txHash}.`
        );
        return txHash;
    }

    /**
     * Confirms agent's underlying withdrawal, if already allowed. Otherwise it marks in persistent state that confirmation
     * of underlying withdrawal has started and it is then handled by method 'handleAgentsWaitingsAndCleanUp' in AgentBot.ts.
     * @param agentVault agent's vault address
     * @param txHash transaction hash of underlying withdrawal payment
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
                await this.botConfig.orm!.em.persistAndFlush(agentEnt);
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

    /**
     * Cancels agent's underlying withdrawal, if already allowed. Otherwise it marks in persistent state and it is then handled by method 'handleAgentsWaitingsAndCleanUp' in AgentBot.ts.
     * @param agentVault agent's vault address
     */
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
                await this.botConfig.orm!.em.persistAndFlush(agentEnt);
                this.botConfig.notifier!.sendCancelWithdrawUnderlying(agentVault);
            } else {
                agentEnt.underlyingWithdrawalWaitingForCancelation = true;
                await this.botConfig.orm!.em.persistAndFlush(agentEnt);
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
    async listActiveAgents(): Promise<void> {
        const query = this.botConfig.orm!.em.createQueryBuilder(AgentEntity);
        const listOfAgents = await query.where({ active: true }).getResultList();
        for (const agent of listOfAgents) {
            console.log(
                `Vault: ${agent.vaultAddress}, Pool: ${agent.collateralPoolAddress}, Underlying: ${agent.underlyingAddress}, Chain: ${decodeAttestationName(
                    agent.chainId
                )}, ChainSymbol: ${agent.chainSymbol}, Current event block: ${agent.currentEventBlock} `
            );
        }
    }

    /**
     * Get agent info
     * @param agentVault agent's vault address
     */
    async printAgentInfo(agentVault: string): Promise<void> {
        await printAgentInfo(agentVault, this.context);
    }

    /**
     * Get agent settings
     * @param agentVault agent's vault address
     * @returns object containing instances of AgentSettings
     */
    async printAgentSettings(agentVault: string): Promise<AgentSettings> {
        const info = await this.context.assetManager.getAgentInfo(agentVault);
        const settings = getAgentSettings(info);
        const vaultCollateral = await IERC20.at(settings.vaultCollateralToken);
        const vcSymbol = await vaultCollateral.symbol();
        console.log(`vaultCollateralToken: ${settings.vaultCollateralToken}`);
        console.log(`vaultCollateralSymbol: ${vcSymbol}`);
        console.log(`feeBIPS: ${settings.feeBIPS.toString()}`);
        console.log(`poolFeeShareBIPS: ${settings.poolFeeShareBIPS.toString()}`);
        console.log(`mintingVaultCollateralRatioBIPS: ${settings.mintingVaultCollateralRatioBIPS.toString()}`);
        console.log(`mintingPoolCollateralRatioBIPS: ${settings.mintingPoolCollateralRatioBIPS.toString()}`);
        console.log(`poolExitCollateralRatioBIPS: ${settings.poolExitCollateralRatioBIPS.toString()}`);
        console.log(`buyFAssetByAgentFactorBIPS: ${settings.buyFAssetByAgentFactorBIPS.toString()}`);
        console.log(`poolTopupCollateralRatioBIPS: ${settings.poolTopupCollateralRatioBIPS.toString()}`);
        console.log(`poolTopupTokenPriceFactorBIPS: ${settings.poolTopupTokenPriceFactorBIPS.toString()}`);
        return settings;
    }

    /**
     * Returns AgentBot and AgentBot entity from agent's vault address.
     * @param agentVault agent's vault address
     * @returns object containing instances of AgentBot and AgentEntity respectively
     */
    async getAgentBot(agentVault: string): Promise<{ agentBot: AgentBot; agentEnt: AgentEntity }> {
        const agentEnt = await this.botConfig.orm!.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(this.context, agentEnt, this.botConfig.notifier!);
        return { agentBot, agentEnt };
    }

    /**
     * Delegates pool collateral.
     * @param agentVault agent's vault address
     * @param recipient address of the recipient
     * @param bips percentage of voting power to be delegated in bips
     */
    async delegatePoolCollateral(agentVault: string, recipient: string, bips: string): Promise<void> {
        const agentEnt = await this.botConfig.orm!.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const collateralPool = await CollateralPool.at(agentEnt.collateralPoolAddress);
        await collateralPool.delegate(recipient, bips, { from: agentEnt.ownerAddress });
        this.botConfig.notifier!.sendDelegatePoolCollateral(agentVault, collateralPool.address, recipient, bips);
        logger.info(`Agent ${agentVault} delegated pool collateral to ${recipient} with bips ${bips}.`);
    }

    /**
     * Undelegates pool collateral.
     * @param agentVault agent's vault address
     */
    async undelegatePoolCollateral(agentVault: string): Promise<void> {
        const agentEnt = await this.botConfig.orm!.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const collateralPool = await CollateralPool.at(agentEnt.collateralPoolAddress);
        await collateralPool.undelegateAll({ from: agentEnt.ownerAddress });
        this.botConfig.notifier!.sendUndelegatePoolCollateral(agentVault, collateralPool.address);
        logger.info(`Agent ${agentVault} undelegated all pool collateral.`);
    }

    /**
     * Creates underlying account
     * @returns object containing underlying address and its private key respectively
     */
    async createUnderlyingAccount(): Promise<{ address: string; privateKey: string }> {
        const address = await this.context.wallet.createAccount();
        const walletKeys = new DBWalletKeys(this.botConfig.orm!.em);
        const privateKey = (await walletKeys.getKey(address))!;
        console.log(address, privateKey);
        return { address, privateKey };
    }

    /**
     * Returns agent's free vault collateral
     * @param agentVault agent's vault address
     * @returns amount of free vault collateral
     */
    async getFreeVaultCollateral(agentVault: string): Promise<string> {
        const { agentBot } = await this.getAgentBot(agentVault);
        const info = await agentBot.agent.getAgentInfo();
        const freeCollateral = info.freeVaultCollateralWei.toString();
        console.log(`Agent ${agentVault} has ${freeCollateral} free vault collateral.`);
        logger.info(`Agent ${agentVault} has ${freeCollateral} free vault collateral.`);
        return freeCollateral;
    }

    /**
     * Returns agent's free pool collateral
     * @param agentVault agent's vault address
     * @returns amount of free pool collateral
     */
    async getFreePoolCollateral(agentVault: string): Promise<string> {
        const { agentBot } = await this.getAgentBot(agentVault);
        const info = await agentBot.agent.getAgentInfo();
        const freeCollateral = info.freePoolCollateralNATWei.toString();
        console.log(`Agent ${agentVault} has ${freeCollateral} free pool collateral.`);
        logger.info(`Agent ${agentVault} has ${freeCollateral} free pool collateral.`);
        return freeCollateral;
    }

    /**
     * Returns agent's free underlying
     * @param agentVault agent's vault address
     * @returns amount of free underlying
     */
    async getFreeUnderlying(agentVault: string): Promise<string> {
        const { agentBot } = await this.getAgentBot(agentVault);
        const info = await agentBot.agent.getAgentInfo();
        const freeUnderlying = info.freeUnderlyingBalanceUBA.toString();
        console.log(`Agent ${agentVault} has ${freeUnderlying} free underlying.`);
        logger.info(`Agent ${agentVault} has ${freeUnderlying} free underlying.`);
        return freeUnderlying;
    }

    /**
     * Switches vault collateral
     * @param agentVault agent's vault address
     * @param token vault collateral token address
     */
    async switchVaultCollateral(agentVault: string, token: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.switchVaultCollateral(token);
    }

    /**
     * Upgrades WNat contract
     * @param agentVault agent's vault address
     */
    async upgradeWNatContract(agentVault: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.upgradeWNatContract();
    }
}
