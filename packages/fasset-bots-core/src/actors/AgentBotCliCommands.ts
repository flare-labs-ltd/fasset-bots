/* eslint-disable @typescript-eslint/no-non-null-assertion */
import "dotenv/config";

import { AddressValidity, decodeAttestationName } from "@flarenetwork/state-connector-protocol";
import { FilterQuery } from "@mikro-orm/core";
import BN from "bn.js";
import chalk from "chalk";
import { InfoBot } from "..";
import { AgentSettingsConfig, Schema_AgentSettingsConfig } from "../config";
import { BotConfig, createAgentBotDefaultSettings, createBotConfig, decodedChainId, loadAgentConfigFile } from "../config/BotConfig";
import { createAssetContext } from "../config/create-asset-context";
import { getSecrets, requireSecret } from "../config/secrets";
import { AgentEntity } from "../entities/agent";
import { AgentBotDefaultSettings, IAssetAgentBotContext } from "../fasset-bots/IAssetBotContext";
import { Agent, OwnerAddressPair } from "../fasset/Agent";
import { AgentSettings, CollateralClass } from "../fasset/AssetManagerTypes";
import { ChainInfo } from "../fasset/ChainInfo";
import { DBWalletKeys } from "../underlying-chain/WalletKeys";
import { resolveInFassetBotsCore } from "../utils";
import { getAgentSettings, proveAndUpdateUnderlyingBlock } from "../utils/fasset-helpers";
import { BN_ZERO, CommandLineError, ZERO_ADDRESS, ZERO_BYTES32, errorIncluded, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { artifacts, authenticatedHttpProvider, initWeb3 } from "../utils/web3";
import { latestBlockTimestampBN } from "../utils/web3helpers";
import { AgentBot } from "./AgentBot";

const CollateralPool = artifacts.require("CollateralPool");
const IERC20 = artifacts.require("IERC20Metadata");

export class BotCliCommands {
    static deepCopyWithObjectCreate = true;

    context!: IAssetAgentBotContext;
    owner!: OwnerAddressPair;
    botConfig!: BotConfig;
    BotFAssetInfo!: ChainInfo;

    /**
     *
     * Creates instance of BotCliCommands.
     * @param runConfigFile path to configuration file
     * @param fAssetSymbol symbol for the fasset
     * @returns instance of BotCliCommands class
     */
    static async create(runConfigFile: string, fAssetSymbol: string) {
        const bot = new BotCliCommands();
        await bot.initEnvironment(runConfigFile, fAssetSymbol);
        return bot;
    }

    /**
     * Initializes asset context from AgentBotRunConfig
     * @param runConfigFile path to configuration file
     * @param fAssetSymbol symbol for the fasset
     */
    async initEnvironment(runConfigFile: string, fAssetSymbol: string): Promise<void> {
        this.owner = new OwnerAddressPair(requireSecret("owner.management.address"), requireSecret("owner.native.address"));
        // load config
        logger.info(`Owner ${this.owner.managementAddress} started to initialize cli environment.`);
        console.log(chalk.cyan("Initializing environment..."));
        const runConfig = loadAgentConfigFile(runConfigFile, `Owner ${this.owner.managementAddress}`);
        // init web3 and accounts
        const nativePrivateKey = requireSecret("owner.native.private_key");
        const accounts = await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), [nativePrivateKey], null);
        /* istanbul ignore next */
        if (this.owner.workAddress !== accounts[0]) {
            logger.error(`Owner ${this.owner.managementAddress} has invalid address/private key pair.`);
            throw new Error("Invalid address/private key pair");
        }
        // create config
        this.botConfig = await createBotConfig(runConfig, this.owner.workAddress);
        // create context
        const chainConfig = this.botConfig.fAssets.find((cc) => cc.fAssetSymbol === fAssetSymbol);
        if (chainConfig == null) {
            logger.error(`Owner ${this.owner.managementAddress} has invalid FAsset symbol ${fAssetSymbol}.`);
            throw new CommandLineError(`Invalid FAsset symbol ${fAssetSymbol}`);
        }
        this.BotFAssetInfo = chainConfig.chainInfo;
        this.context = await createAssetContext(this.botConfig, chainConfig);
        // verify keys
        this.verifyWorkAddress(this.owner);
        // create underlying wallet key
        const underlyingAddress = requireSecret(`owner.${decodedChainId(this.BotFAssetInfo.chainId)}.address`);
        const underlyingPrivateKey = requireSecret(`owner.${decodedChainId(this.BotFAssetInfo.chainId)}.private_key`);
        await this.context.wallet.addExistingAccount(underlyingAddress, underlyingPrivateKey);
        console.log(chalk.cyan("Environment successfully initialized."));
        logger.info(`Owner ${this.owner.managementAddress} successfully finished initializing cli environment.`);
    }

    async verifyWorkAddress(owner: OwnerAddressPair) {
        // get work address
        const chainWorkAddress = await Agent.getOwnerWorkAddress(this.context, owner.managementAddress);
        // ensure that work address is defined and matches the one from secrets.json
        if (chainWorkAddress === ZERO_ADDRESS) {
            throw new Error(`Management address ${owner.managementAddress} has no registered work address.`);
        } else if (chainWorkAddress !== owner.workAddress) {
            throw new Error(`Work address ${chainWorkAddress} registered by management address ${owner.managementAddress} does not match the owner.native address ${owner.workAddress} from your secrets file.`);
        }
    }

    async prepareCreateAgentSettings(): Promise<Schema_AgentSettingsConfig> {
        const allCollaterals = await this.context.assetManager.getCollateralTypes();
        const collaterals = allCollaterals.filter(c => Number(c.collateralClass) === CollateralClass.VAULT && String(c.validUntil) === "0");
        const schema = resolveInFassetBotsCore("run-config/schema/agent-settings.schema.json").replace(/\\/g, "/");
        return {
            $schema: `file://${schema.startsWith("/") ? "" : "/"}${schema}`,
            poolTokenSuffix: "",
            vaultCollateralFtsoSymbol: collaterals.map(c => c.tokenFtsoSymbol).join("|"),
            fee: "0.25%",
            poolFeeShare: "40%",
            mintingVaultCollateralRatio: "1.6",
            mintingPoolCollateralRatio: "2.4",
            poolExitCollateralRatio: "2.6",
            poolTopupCollateralRatio: "2.2",
            poolTopupTokenPriceFactor: "0.8",
            buyFAssetByAgentFactor: "0.99",
        };
    }

    /**
     * Creates instance of Agent.
     * @param agentSettings
     */
    async createAgentVault(agentSettings: AgentSettingsConfig): Promise<Agent | null> {
        await this.validateCollateralPoolTokenSuffix(agentSettings.poolTokenSuffix);
        try {
            const underlyingAddress = await AgentBot.createUnderlyingAddress(this.botConfig.orm!.em, this.context);
            console.log(`Validating new underlying address ${underlyingAddress}...`);
            console.log(`Owner ${this.owner} validating new underlying address ${underlyingAddress}.`);
            // const addressValidityProof = await AgentBot.initializeUnderlyingAddress(this.context, this.owner, underlyingAddress);
            const [addressValidityProof, _] = await Promise.all([
                AgentBot.initializeUnderlyingAddress(this.context, this.owner, underlyingAddress),
                proveAndUpdateUnderlyingBlock(this.context.attestationProvider, this.context.assetManager, this.owner.workAddress),
            ]);
            console.log(`Creating agent bot...`);
            const agentBotSettings: AgentBotDefaultSettings = await createAgentBotDefaultSettings(this.context, agentSettings);
            const agentBot = await AgentBot.create(this.botConfig.orm!.em, this.context, this.owner, addressValidityProof, agentBotSettings, this.botConfig.notifier!);
            await this.botConfig.notifier!.sendAgentCreated(agentBot.agent.vaultAddress);
            console.log(`Agent bot created.`);
            console.log(`Owner ${this.owner} created new agent vault at ${agentBot.agent.agentVault.address}.`);
            return agentBot.agent;
        } catch (error) {
            logger.error(`Owner ${this.owner} couldn't create agent:`, error);
            throw error;
        }
    }

    /**
     * Deposits class 1 collateral to agent's vault from owner.
     * @param agentVault agent's vault address
     * @param amount amount to be deposited
     */
    async depositToVault(agentVault: string, amount: string | BN): Promise<void> {
        logger.info(`Agent's ${agentVault} owner ${this.owner} is starting vault collateral deposit ${amount}.`);
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.depositVaultCollateral(amount);
        await this.botConfig.notifier!.sendVaultCollateralDeposit(agentVault, amount);
        logger.info(`Agent's ${agentVault} owner ${this.owner} deposited vault collateral ${amount}.`);
    }

    /**
     * Buys collateral pool tokens for agent.
     * @param agentVault agent's vault address
     * @param amount add pool tokens in that correspond to amount of nat
     */
    async buyCollateralPoolTokens(agentVault: string, amount: string | BN): Promise<void> {
        logger.info(`Agent's ${agentVault} owner ${this.owner} is starting to buy collateral pool tokens ${amount}.`);
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.buyCollateralPoolTokens(amount);
        await this.botConfig.notifier!.sendBuyCollateralPoolTokens(agentVault, amount);
        logger.info(`Agent's ${agentVault} owner ${this.owner} bought collateral pool tokens ${amount}.`);
    }

    /**
     * Enters agent to available list, so agent can be minted against.
     * @param agentVault agent's vault address
     */
    async enterAvailableList(agentVault: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.makeAvailable();
        await this.botConfig.notifier!.sendAgentEnteredAvailable(agentVault);
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
        await this.botConfig.notifier!.sendAgentAnnouncedExitAvailable(agentVault);
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
     * Announces agent's withdrawal of vault collateral. It marks in persistent state that withdrawal of vault collateral
     * has started and it is then handled by method 'handleAgentsWaitingsAndCleanUp' in AgentBot.ts.
     * @param agentVault agent's vault address
     * @param amount amount to be withdrawn
     */
    async announceWithdrawFromVault(agentVault: string, amount: string | BN): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        const withdrawalAllowedAt = await agentBot.agent.announceVaultCollateralWithdrawal(amount);
        await this.botConfig.notifier!.sendWithdrawVaultCollateralAnnouncement(agentVault, amount);
        agentEnt.withdrawalAllowedAtTimestamp = withdrawalAllowedAt;
        agentEnt.withdrawalAllowedAtAmount = String(amount);
        await this.botConfig.orm!.em.persistAndFlush(agentEnt);
        logger.info(`Agent ${agentVault} announced vault collateral withdrawal ${amount} at ${withdrawalAllowedAt.toString()}.`);
    }

    /**
     * Cancels agent's vault collateral announcement.
     * @param agentVault agent's vault address
     */
    async cancelWithdrawFromVaultAnnouncement(agentVault: string): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        await agentBot.agent.announceVaultCollateralWithdrawal(BN_ZERO);
        await this.botConfig.notifier!.sendCancelVaultCollateralAnnouncement(agentVault);
        agentEnt.withdrawalAllowedAtTimestamp = BN_ZERO;
        agentEnt.withdrawalAllowedAtAmount = "";
        await this.botConfig.orm!.em.persistAndFlush(agentEnt);
        logger.info(`Agent ${agentVault} cancelled vault collateral withdrawal announcement.`);
    }

    /**
     * Announces agent's pool token redemption. It marks in persistent state that redemption of pool tokens
     * has started and it is then handled by method 'handleAgentsWaitingsAndCleanUp' in AgentBot.ts.
     * @param agentVault agent's vault address
     * @param amount amount to be redeemed
     */
    async announceRedeemCollateralPoolTokens(agentVault: string, amount: string | BN): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        const withdrawalAllowedAt = await agentBot.agent.announcePoolTokenRedemption(amount);
        await this.botConfig.notifier!.sendRedeemCollateralPoolTokensAnnouncement(agentVault, amount);
        agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp = withdrawalAllowedAt;
        agentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount = String(amount);
        await this.botConfig.orm!.em.persistAndFlush(agentEnt);
        logger.info(`Agent ${agentVault} announced pool token redemption of ${amount} at ${withdrawalAllowedAt.toString()}.`);
    }

    /**
     * Cancels agent's pool token redemption announcement.
     * @param agentVault agent's vault address
     */
    async cancelCollateralPoolTokensAnnouncement(agentVault: string): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        await agentBot.agent.announceVaultCollateralWithdrawal(BN_ZERO);
        await this.botConfig.notifier!.sendCancelRedeemCollateralPoolTokensAnnouncement(agentVault);
        agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp = BN_ZERO;
        agentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount = "";
        await this.botConfig.orm!.em.persistAndFlush(agentEnt);
        logger.info(`Agent ${agentVault} cancelled pool token redemption announcement.`);
    }

    /**
     * Withdraws agent's pool fees.
     * @param agentVault agent's vault address
     * @param amount amount to be withdrawn
     */
    async withdrawPoolFees(agentVault: string, amount: string | BN): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.withdrawPoolFees(amount);
        await this.botConfig.notifier!.sendWithdrawPoolFees(agentVault, amount);
        logger.info(`Agent ${agentVault} withdrew pool fees ${amount}.`);
    }

    /**
     * Returns agent's pool fee balance.
     * @param agentVault agent's vault address
     */
    async poolFeesBalance(agentVault: string): Promise<string> {
        const { agentBot } = await this.getAgentBot(agentVault);
        const balance = await agentBot.agent.poolFeeBalance();
        await this.botConfig.notifier!.sendBalancePoolFees(agentVault, balance.toString());
        logger.info(`Agent ${agentVault} has pool fee ${balance.toString()}.`);
        return balance.toString();
    }

    /**
     * Starts agent's self closing process.
     * @param agentVault agent's vault address
     * @param amountUBa amount of fassets to self-close
     */
    async selfClose(agentVault: string, amountUBA: string | BN): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.selfClose(amountUBA);
        await this.botConfig.notifier!.sendSelfClose(agentVault);
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
            await this.botConfig.notifier!.sendAnnounceUnderlyingWithdrawal(agentVault, announce.paymentReference);
            logger.info(`Agent ${agentVault} announced underlying withdrawal at ${agentEnt.underlyingWithdrawalAnnouncedAtTimestamp.toString()} with reference ${announce.paymentReference}.`);
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
    async performUnderlyingWithdrawal(agentVault: string, amount: string | BN, destinationAddress: string, paymentReference: string): Promise<string> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        const txHash = await agentBot.agent.performUnderlyingWithdrawal(paymentReference, amount, destinationAddress);
        agentEnt.underlyingWithdrawalConfirmTransaction = txHash;
        await this.botConfig.orm!.em.persistAndFlush(agentEnt);
        await this.botConfig.notifier!.sendUnderlyingWithdrawalPerformed(agentVault, txHash);
        logger.info(`Agent ${agentVault} performed underlying withdrawal ${amount} to ${destinationAddress} with reference ${paymentReference} and txHash ${txHash}.`);
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
                await this.botConfig.notifier!.sendConfirmWithdrawUnderlying(agentVault);
            } else {
                logger.info(`Agent ${agentVault} cannot yet confirm underlying withdrawal. Allowed at ${toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).add(announcedUnderlyingConfirmationMinSeconds).toString()}. Current ${latestTimestamp.toString()}.`);
                console.log(`Agent ${agentVault} cannot yet confirm underlying withdrawal. Allowed at ${toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).add(announcedUnderlyingConfirmationMinSeconds).toString()}. Current ${latestTimestamp.toString()}.`);
            }
        } else {
            await this.botConfig.notifier!.sendNoActiveWithdrawal(agentVault);
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
                await this.botConfig.notifier!.sendCancelWithdrawUnderlying(agentVault);
            } else {
                agentEnt.underlyingWithdrawalWaitingForCancelation = true;
                await this.botConfig.orm!.em.persistAndFlush(agentEnt);
                logger.info(`Agent ${agentVault} cannot yet cancel underlying withdrawal. Allowed at ${toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).add(announcedUnderlyingConfirmationMinSeconds).toString()}. Current ${latestTimestamp.toString()}.`);
                console.log(`Agent ${agentVault} cannot yet cancel underlying withdrawal. Allowed at ${toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).add(announcedUnderlyingConfirmationMinSeconds).toString()}. Current ${latestTimestamp.toString()}.`);
            }
        } else {
            await this.botConfig.notifier!.sendNoActiveWithdrawal(agentVault);
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
            console.log(`Vault: ${agent.vaultAddress}, Pool: ${agent.collateralPoolAddress}, Underlying: ${agent.underlyingAddress}, Chain: ${decodeAttestationName(agent.chainId)}, ChainSymbol: ${agent.chainSymbol}, Current event block: ${agent.currentEventBlock} `);
        }
    }

    /**
     * Get agent info
     * @param agentVault agent's vault address
     */
    async printAgentInfo(agentVault: string): Promise<void> {
        const infoBot = new InfoBot(this.context);
        await infoBot.printAgentInfo(agentVault);
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
    async delegatePoolCollateral(agentVault: string, recipient: string, bips: string | BN): Promise<void> {
        const agentEnt = await this.botConfig.orm!.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const collateralPool = await CollateralPool.at(agentEnt.collateralPoolAddress);
        await collateralPool.delegate(recipient, bips, { from: agentEnt.ownerAddress });
        await this.botConfig.notifier!.sendDelegatePoolCollateral(agentVault, collateralPool.address, recipient, bips);
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
        await this.botConfig.notifier!.sendUndelegatePoolCollateral(agentVault, collateralPool.address);
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
        return info.freeVaultCollateralWei.toString();
    }

    /**
     * Returns agent's free pool collateral
     * @param agentVault agent's vault address
     * @returns amount of free pool collateral
     */
    async getFreePoolCollateral(agentVault: string): Promise<string> {
        const { agentBot } = await this.getAgentBot(agentVault);
        const info = await agentBot.agent.getAgentInfo();
        return info.freePoolCollateralNATWei.toString();
    }

    /**
     * Returns agent's free underlying
     * @param agentVault agent's vault address
     * @returns amount of free underlying
     */
    async getFreeUnderlying(agentVault: string): Promise<string> {
        const { agentBot } = await this.getAgentBot(agentVault);
        const info = await agentBot.agent.getAgentInfo();
        return info.freeUnderlyingBalanceUBA.toString();
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

    // HACK - until fasset-v2 support pool token validity check, exploit the fact that token validation is the first thing in createAgentVault call
    private async validateCollateralPoolTokenSuffix(suffix: string) {
        const fakeAddressProof: AddressValidity.Proof = {
            data: {
                attestationType: "0x4164647265737356616c69646974790000000000000000000000000000000000",
                lowestUsedTimestamp: "0xffffffffffffffff",
                requestBody: { addressStr: ZERO_ADDRESS },
                responseBody: { isValid: false, standardAddress: ZERO_ADDRESS, standardAddressHash: ZERO_BYTES32 },
                sourceId: "0x7465737458525000000000000000000000000000000000000000000000000000",
                votingRound: "0",
            },
            merkleProof: [],
        };
        const fakeSettings: AgentSettings = {
            poolTokenSuffix: suffix,
            vaultCollateralToken: ZERO_ADDRESS,
            feeBIPS: "0",
            poolFeeShareBIPS: "0",
            buyFAssetByAgentFactorBIPS: "0",
            mintingPoolCollateralRatioBIPS: "0",
            mintingVaultCollateralRatioBIPS: "0",
            poolExitCollateralRatioBIPS: "0",
            poolTopupCollateralRatioBIPS: "0",
            poolTopupTokenPriceFactorBIPS: "0",
        };
        try {
            await this.context.assetManager.createAgentVault.call(fakeAddressProof, fakeSettings);
        } catch (e: unknown) {
            if (errorIncluded(e, ["suffix already reserved"])) {
                throw new CommandLineError(`Agent vault with collateral pool token suffix "${suffix}" already exists.`);
            } else if (errorIncluded(e, ["invalid character in suffix"])) {
                throw new CommandLineError(`Collateral pool token suffix "${suffix}" contains invalid characters.`);
            }
        }
    }
}
