import "dotenv/config";

import { decodeAttestationName } from "@flarenetwork/state-connector-protocol";
import BN from "bn.js";
import chalk from "chalk";
import { InfoBotCommands } from "..";
import { AgentBot } from "../actors/AgentBot";
import { AgentVaultInitSettings, createAgentVaultInitSettings } from "../config/AgentVaultInitSettings";
import { AgentBotConfig, AgentBotSettings, closeBotConfig, createBotConfig } from "../config/BotConfig";
import { loadAgentConfigFile } from "../config/config-file-loader";
import { AgentSettingsConfig, Schema_AgentSettingsConfig } from "../config/config-files/AgentSettingsConfig";
import { createAgentBotContext } from "../config/create-asset-context";
import { ORM } from "../config/orm";
import { Secrets } from "../config/secrets";
import { AgentEntity } from "../entities/agent";
import { AgentSettingName } from "../entities/common";
import { IAssetAgentContext } from "../fasset-bots/IAssetBotContext";
import { Agent, OwnerAddressPair } from "../fasset/Agent";
import { AgentSettings, CollateralClass } from "../fasset/AssetManagerTypes";
import { DBWalletKeys } from "../underlying-chain/WalletKeys";
import { Currencies, TokenBalances, formatBips, resolveInFassetBotsCore, squashSpace } from "../utils";
import { CommandLineError, assertCmd, assertNotNullCmd } from "../utils/command-line-errors";
import { getAgentSettings, proveAndUpdateUnderlyingBlock } from "../utils/fasset-helpers";
import { BN_ZERO, MAX_BIPS, errorIncluded, maxBN, requireNotNull, toBN, isEnumValue } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";
import { NotifierTransport } from "../utils/notifier/BaseNotifier";
import { artifacts, authenticatedHttpProvider, initWeb3 } from "../utils/web3";
import { latestBlockTimestampBN } from "../utils/web3helpers";
import { AgentBotOwnerValidation } from "./AgentBotOwnerValidation";

const CollateralPool = artifacts.require("CollateralPool");
const IERC20 = artifacts.require("IERC20Metadata");

type CleanupRegistration = (handler: () => Promise<void>) => void;

export class AgentBotCommands {
    static deepCopyWithObjectCreate = true;

    constructor(
        public context: IAssetAgentContext,
        public agentBotSettings: AgentBotSettings,
        public owner: OwnerAddressPair,
        public ownerUnderlyingAddress: string,
        public orm: ORM,
        public notifiers: NotifierTransport[],
    ) {}

    /**
     * Creates instance of BotCliCommands.
     * @param configFileName path to configuration file
     * @param fAssetSymbol symbol for the fasset
     * @returns instance of BotCliCommands class
     */
    static async create(secretsFile: string, configFileName: string, fAssetSymbol: string, registerCleanup?: CleanupRegistration, validate: boolean = true) {
        console.log(chalk.cyan("Initializing environment..."));
        const botConfig = await AgentBotCommands.createBotConfig(secretsFile, configFileName, registerCleanup, validate);
        const agentBotCommands = await AgentBotCommands.createBotCommands(botConfig, fAssetSymbol, validate);
        console.log(chalk.cyan("Environment successfully initialized."));
        return agentBotCommands;
    }

    static async createBotConfig(secretsFile: string, configFileName: string, registerCleanup?: CleanupRegistration, validate: boolean = true) {
        const secrets = Secrets.load(secretsFile);
        const owner = AgentBotCommands.getOwnerAddressPair(secrets);
        // load config
        logger.info(`Owner ${owner.managementAddress} started to initialize cli environment.`);
        const configFile = loadAgentConfigFile(configFileName, `Owner ${owner.managementAddress}`);
        // init web3 and accounts
        const workPrivateKey = secrets.required("owner.native.private_key");
        const apiKey = secrets.optional("apiKey.native_rpc");
        await initWeb3(authenticatedHttpProvider(configFile.rpcUrl, apiKey), [workPrivateKey], null);
        if (validate) {
            AgentBotOwnerValidation.verifyWorkPrivateKey(owner, workPrivateKey);
        }
        // create config
        const botConfig = await createBotConfig("agent", secrets, configFile, owner.workAddress);
        registerCleanup?.(() => closeBotConfig(botConfig));
        return botConfig;
    }

    static async createBotCommands(botConfig: AgentBotConfig, fAssetSymbol: string, validate: boolean = true) {
        const secrets = botConfig.secrets;
        // create context
        const chainConfig = botConfig.fAssets.get(fAssetSymbol);
        assertNotNullCmd(chainConfig, `Invalid FAsset symbol ${fAssetSymbol}`);
        const context = await createAgentBotContext(botConfig, chainConfig);
        // verify keys
        const owner = AgentBotCommands.getOwnerAddressPair(secrets);
        if (validate) {
            await AgentBotOwnerValidation.verifyAgentWhitelisted(context.agentOwnerRegistry, owner);
            await AgentBotOwnerValidation.verifyWorkAddress(context.agentOwnerRegistry, owner);
        }
        // create underlying wallet key
        const underlyingAddress = secrets.required(`owner.${chainConfig.chainInfo.chainId.chainName}.address`);
        const underlyingPrivateKey = secrets.required(`owner.${chainConfig.chainInfo.chainId.chainName}.private_key`);
        await context.wallet.addExistingAccount(underlyingAddress, underlyingPrivateKey);
        logger.info(`Owner ${owner.managementAddress} successfully finished initializing cli environment.`);
        logger.info(`Asset manager controller is ${context.assetManagerController.address}, asset manager for ${fAssetSymbol} is ${context.assetManager.address}.`);
        return new AgentBotCommands(context, chainConfig.agentBotSettings, owner, underlyingAddress, botConfig.orm, botConfig.notifiers);
    }

    static getOwnerAddressPair(secrets: Secrets) {
        return new OwnerAddressPair(secrets.required("owner.management.address"), secrets.required("owner.native.address"));
    }

    notifierFor(agentVault: string) {
        return new AgentNotifier(agentVault, this.notifiers);
    }

    infoBot() {
        return new InfoBotCommands(this.context);
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
    async createAgentVault(agentSettings: AgentSettingsConfig): Promise<Agent> {
        await this.validateCollateralPoolTokenSuffix(agentSettings.poolTokenSuffix);
        try {
            const underlyingAddress = await AgentBot.createUnderlyingAddress(this.context);
            console.log(`Validating new underlying address ${underlyingAddress}...`);
            console.log(`Owner ${this.owner} validating new underlying address ${underlyingAddress}.`);
            const [addressValidityProof, _] = await Promise.all([
                AgentBot.initializeUnderlyingAddress(this.context, this.owner, this.ownerUnderlyingAddress, underlyingAddress),
                proveAndUpdateUnderlyingBlock(this.context.attestationProvider, this.context.assetManager, this.owner.workAddress),
            ]);
            console.log(`Creating agent bot...`);
            const agentBotSettings: AgentVaultInitSettings = await createAgentVaultInitSettings(this.context, agentSettings);
            const agentBot = await AgentBot.create(this.orm.em, this.context, this.agentBotSettings, this.owner, this.ownerUnderlyingAddress,
                addressValidityProof, agentBotSettings, this.notifiers);
            await this.notifierFor(agentBot.agent.vaultAddress).sendAgentCreated();
            console.log(`Agent bot created.`);
            console.log(`Owner ${this.owner} created new agent vault at ${agentBot.agent.agentVault.address}.`);
            return agentBot.agent;
        } catch (error) {
            logger.error(`Owner ${this.owner} couldn't create agent:`, error);
            throw error;
        }
    }

    /**
     * Deposit enough of both collaterals to be able to mint `lots` lots. (Doesn't consider collateral already in the vault / pool.)
     * @param agentVault agent vault address
     * @param lots number of lots, must be whole number
     * @param multiplier a number with which the deposit amount will be multiplied, to compensate for small price changes
     */
    async depositCollateralForLots(agentVault: string, lots: string | BN, multiplier: string | number) {
        const { agentBot } = await this.getAgentBot(agentVault);
        const lotSize = await this.infoBot().getLotSizeBN();
        const amountUBA = toBN(lots).mul(lotSize);
        // calculate collateral amounts and validate balances
        const vaultCollateral = await this.mintingVaultCollateral(agentBot.agent, amountUBA, Number(multiplier));
        await this.checkVaultBalance(agentVault, vaultCollateral);
        const poolCollateral = await this.mintingPoolCollateral(agentBot.agent, amountUBA, Number(multiplier));
        await this.checkPoolBalance(agentVault, poolCollateral);
        // perform deposit
        await this.depositToVault(agentVault, vaultCollateral);
        await this.buyCollateralPoolTokens(agentVault, poolCollateral);
    }

    async mintingVaultCollateral(agent: Agent, amountUBA: BN, multiplier: number) {
        const agentInfo = await agent.getAgentInfo();
        const price = await agent.getVaultCollateralPrice();
        const mintingCRBips = maxBN(toBN(price.collateral.minCollateralRatioBIPS), toBN(agentInfo.mintingVaultCollateralRatioBIPS));
        return price.convertUBAToTokenWei(amountUBA).mul(mintingCRBips).muln(Number(multiplier)).addn(MAX_BIPS - 1).divn(MAX_BIPS);
    }

    async checkVaultBalance(agentVault: string, depositAmount: BN) {
        const balanceReader = await TokenBalances.agentVaultCollateral(this.context, agentVault);
        const ownerBalance = await balanceReader.balance(this.owner.workAddress);
        if (ownerBalance.lt(depositAmount)) {
            const balanceFmt = balanceReader.format(ownerBalance);
            const requiredFmt = balanceReader.format(depositAmount);
            throw new CommandLineError(squashSpace`Not enough ${balanceReader.symbol} on owner's work address. Balance is ${balanceFmt}, required ${requiredFmt}.
                Vault collateral deposit will probably fail.`);
        }
    }

    async mintingPoolCollateral(agent: Agent, amountUBA: BN, multiplier: number) {
        const agentInfo = await agent.getAgentInfo();
        const price = await agent.getPoolCollateralPrice();
        const mintingCRBips = maxBN(toBN(price.collateral.minCollateralRatioBIPS), toBN(agentInfo.mintingPoolCollateralRatioBIPS));
        return price.convertUBAToTokenWei(amountUBA).mul(mintingCRBips).muln(Number(multiplier)).addn(MAX_BIPS - 1).divn(MAX_BIPS);
    }

    async checkPoolBalance(agentVault: string, depositAmount: BN) {
        const balanceReader = await TokenBalances.evmNative(this.context);
        const ownerBalance = await balanceReader.balance(this.owner.workAddress);
        if (ownerBalance.lt(depositAmount)) {
            const balanceFmt = balanceReader.format(ownerBalance);
            const requiredFmt = balanceReader.format(depositAmount);
            throw new CommandLineError(squashSpace`Not enough ${balanceReader.symbol} on owner's work address. Balance is ${balanceFmt}, required ${requiredFmt}.
                Pool collateral deposit will probably fail.`);
        }
    }

    /**
     * Deposits class 1 collateral to agent's vault from owner.
     * @param agentVault agent's vault address
     * @param amount amount to be deposited
     */
    async depositToVault(agentVault: string, amount: string | BN): Promise<void> {
        const currency = await Currencies.agentVaultCollateral(this.context, agentVault);
        const amountf = currency.format(amount);
        logger.info(`Agent's ${agentVault} owner ${this.owner} is starting vault collateral deposit ${amountf} tokens.`);
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.depositVaultCollateral(amount);
        await this.notifierFor(agentVault).sendVaultCollateralDeposit(amountf);
        logger.info(`Agent's ${agentVault} owner ${this.owner} deposited ${amountf} vault collateral tokens.`);
    }

    /**
     * Buys collateral pool tokens for agent.
     * @param agentVault agent's vault address
     * @param amount add pool tokens in that correspond to amount of nat
     */
    async buyCollateralPoolTokens(agentVault: string, amount: string | BN): Promise<void> {
        const currency = await Currencies.agentPoolCollateral(this.context, agentVault);
        const amountf = currency.format(amount);
        logger.info(`Agent's ${agentVault} owner ${this.owner} is starting to buy ${amountf} worth of collateral pool tokens.`);
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.buyCollateralPoolTokens(amount);
        await this.notifierFor(agentVault).sendBuyCollateralPoolTokens(amountf);
        logger.info(`Agent's ${agentVault} owner ${this.owner} bought ${amountf} worth of collateral pool tokens.`);
    }

    /**
     * Enters agent to available list, so agent can be minted against.
     * @param agentVault agent's vault address
     */
    async enterAvailableList(agentVault: string): Promise<void> {
        const { agentBot, readAgentEnt } = await this.getAgentBot(agentVault);
        if (readAgentEnt.waitingForDestructionCleanUp || readAgentEnt.waitingForDestructionTimestamp.gt(BN_ZERO)) {
            throw new CommandLineError("Agent is closing, cannot re-enter.");
        }
        await agentBot.agent.makeAvailable();
        await this.notifierFor(agentVault).sendAgentEnteredAvailable();
        logger.info(`Agent ${agentVault} entered available list.`);
    }

    /**
     * Announces agent's exit from available list. It marks in persistent state that exit from available list
     * has started and it is then handled in AgentBot.ts.
     * @param agentVault agent's vault address
     */
    async announceExitAvailableList(agentVault: string): Promise<void> {
        logger.info(`Agent ${agentVault} is trying to announce exit available list.`);
        const { agentBot, readAgentEnt } = await this.getAgentBot(agentVault);
        const status = await agentBot.getExitAvailableProcessStatus(readAgentEnt);
        if (status === "NOT_ANNOUNCED") {
            const exitAllowedAt = await agentBot.agent.announceExitAvailable();
            await agentBot.updateAgentEntity(this.orm.em, async (agentEnt) => {
                agentEnt.exitAvailableAllowedAtTimestamp = exitAllowedAt;
            });
            await this.notifierFor(agentVault).sendAgentAnnouncedExitAvailable();
            logger.info(`Agent ${agentVault} announced exit available list at ${exitAllowedAt.toString()}.`);
        } else {
            logger.info(`Agent ${agentVault} has already announced available list exit.`);
        }
    }

    /**
     * Exit agent's available list.
     * @param agentVault agent's vault address
     */
    async exitAvailableList(agentVault: string): Promise<void> {
        logger.info(`Agent ${agentVault} is trying to exit available list.`);
        const { agentBot, readAgentEnt } = await this.getAgentBot(agentVault);
        try {
            await agentBot.exitAvailable(this.orm.em);
        } catch (error) {
            if (errorIncluded(error, ["exit not announced"])) {
                logger.error(`Agent ${agentVault} cannot exit - exit not announced.`);
                throw new CommandLineError(`Agent ${readAgentEnt.vaultAddress} cannot exit available list - exit not announced.`);
            }
            if (errorIncluded(error, ["exit too soon"])) {
                logger.error(`Agent ${agentVault} cannot exit - exit too soon. Allowed at ${readAgentEnt.exitAvailableAllowedAtTimestamp}, current timestamp is ${await latestBlockTimestampBN()}.`);
                throw new CommandLineError(squashSpace`Agent ${readAgentEnt.vaultAddress} cannot exit available list.
                    Allowed at ${readAgentEnt.exitAvailableAllowedAtTimestamp}, current timestamp is ${await latestBlockTimestampBN()}.`);
            }
            throw error;
        }
    }

    /**
     * Announces agent's withdrawal of vault collateral. It marks in persistent state that withdrawal of vault collateral
     * has started and it is then handled in AgentBot.ts.
     * @param agentVault agent's vault address
     * @param amount amount to be withdrawn
     */
    async announceWithdrawFromVault(agentVault: string, amount: string | BN): Promise<void> {
        logger.info(`Agent ${agentVault} is trying to announce withdraw from vault with amount ${amount.toString()}.`);
        const { agentBot } = await this.getAgentBot(agentVault);
        const withdrawalAllowedAt = await agentBot.agent.announceVaultCollateralWithdrawal(amount);
        const amountF = await agentBot.tokens.vaultCollateral.format(amount);
        await agentBot.updateAgentEntity(this.orm.em, async (agentEnt) => {
            agentEnt.withdrawalAllowedAtTimestamp = withdrawalAllowedAt;
            agentEnt.withdrawalAllowedAtAmount = String(amount);
        });
        await this.notifierFor(agentVault).sendWithdrawVaultCollateralAnnouncement(amountF);
        logger.info(`Agent ${agentVault} announced vault collateral withdrawal ${amountF} at ${withdrawalAllowedAt.toString()}.`);
    }

    /**
     * Cancels agent's vault collateral announcement.
     * @param agentVault agent's vault address
     */
    async cancelWithdrawFromVaultAnnouncement(agentVault: string): Promise<void> {
        logger.info(`Agent ${agentVault} is trying to cancel withdraw from vault announcement.`);
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.announceVaultCollateralWithdrawal(BN_ZERO);
        await agentBot.updateAgentEntity(this.orm.em, async (agentEnt) => {
            agentEnt.withdrawalAllowedAtTimestamp = BN_ZERO;
            agentEnt.withdrawalAllowedAtAmount = "";
        });
        await this.notifierFor(agentVault).sendCancelVaultCollateralAnnouncement();
        logger.info(`Agent ${agentVault} cancelled vault collateral withdrawal announcement.`);
    }

    /**
     * Announces agent's pool token redemption. It marks in persistent state that redemption of pool tokens
     * has started and it is then handled in AgentBot.ts.
     * @param agentVault agent's vault address
     * @param amount amount to be redeemed
     */
    async announceRedeemCollateralPoolTokens(agentVault: string, amount: string | BN): Promise<void> {
        logger.info(`Agent ${agentVault} is trying to announce collateral pool token redemption with amount ${amount.toString()}.`);
        const { agentBot } = await this.getAgentBot(agentVault);
        const withdrawalAllowedAt = await agentBot.agent.announcePoolTokenRedemption(amount);
        const amountF = await agentBot.tokens.poolToken.format(amount);
        await agentBot.updateAgentEntity(this.orm.em, async (agentEnt) => {
            agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp = withdrawalAllowedAt;
            agentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount = String(amount);
        });
        await this.notifierFor(agentVault).sendRedeemCollateralPoolTokensAnnouncement(amountF);
        logger.info(`Agent ${agentVault} announced pool token redemption of ${amountF} at ${withdrawalAllowedAt.toString()}.`);
    }

    /**
     * Cancels agent's pool token redemption announcement.
     * @param agentVault agent's vault address
     */
    async cancelCollateralPoolTokensAnnouncement(agentVault: string): Promise<void> {
        logger.info(`Agent ${agentVault} is trying to cancel collateral pool redemption announcement.`);
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.announceVaultCollateralWithdrawal(BN_ZERO);
        await agentBot.updateAgentEntity(this.orm.em, async (agentEnt) => {
            agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp = BN_ZERO;
            agentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount = "";
        });
        await this.notifierFor(agentVault).sendCancelRedeemCollateralPoolTokensAnnouncement();
        logger.info(`Agent ${agentVault} cancelled pool token redemption announcement.`);
    }

    /**
     * Withdraws agent's pool fees.
     * @param agentVault agent's vault address
     * @param amount amount to be withdrawn
     */
    async withdrawPoolFees(agentVault: string, amount: string | BN): Promise<void> {
        logger.info(`Agent ${agentVault} is trying to withdraw pool fees with amount ${amount.toString()}.`);
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.withdrawPoolFees(amount);
        const amountF = await agentBot.tokens.fAsset.format(amount);
        await this.notifierFor(agentVault).sendWithdrawPoolFees(amountF);
        logger.info(`Agent ${agentVault} withdrew pool fees ${amountF}.`);
    }

    /**
     * Returns agent's pool fee balance.
     * @param agentVault agent's vault address
     */
    async poolFeesBalance(agentVault: string): Promise<string> {
        const { agentBot } = await this.getAgentBot(agentVault);
        const balance = await agentBot.agent.poolFeeBalance();
        const balanceF = await agentBot.tokens.fAsset.format(balance);
        await this.notifierFor(agentVault).sendBalancePoolFees(balanceF);
        logger.info(`Agent ${agentVault} has pool fee balance ${balanceF}.`);
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
        await this.notifierFor(agentVault).sendSelfClose();
        logger.info(`Agent ${agentVault} self closed vault.`);
    }

    /**
     * Announces agent's settings update. It marks in persistent state that agent's settings update
     * has started and it is then handled by AgentBot.ts.
     * @param agentVault agent's vault address
     * @param settingName
     * @param settingValue
     */
    async updateAgentSetting(agentVault: string, settingName: string, settingValue: string): Promise<void> {
        if (!isEnumValue(AgentSettingName, settingName)) {
            throw new CommandLineError(`Invalid setting name ${settingName}. Valid names are: ${Object.values(AgentSettingName).join(', ')}`);
        }
        const { agentBot, readAgentEnt } = await this.getAgentBot(agentVault);
        const validAt = await agentBot.agent.announceAgentSettingUpdate(settingName, settingValue);
        await agentBot.updateSetting.createAgentUpdateSetting(this.orm.em, settingName, validAt, readAgentEnt);
        const validAtStr = new Date(Number(validAt) * 1000).toString();
        logger.info(`Agent ${agentVault} announced agent settings update for ${settingName}. It will take effect after ${validAtStr} (timestamp ${validAt}).`);
        console.log(`Agent ${agentVault} announced agent settings update for ${settingName}. It will take effect after ${validAtStr}.`);
    }

    /**
     * Starts agent's close vault process. Firstly, it exits available list if necessary.
     * Lastly it marks in persistent state that close vault process has started and it is then
     * handled in AgentBot.ts.
     * @param agentVault agent's vault address
     */
    async closeVault(agentVault: string): Promise<void> {
        const agentEnt = await this.fetchAgentEntity(agentVault);
        const agentInfo = await this.context.assetManager.getAgentInfo(agentVault);
        if (agentInfo.publiclyAvailable) {
            await this.announceExitAvailableList(agentVault);
        }
        agentEnt.waitingForDestructionCleanUp = true;
        await this.orm.em.persistAndFlush(agentEnt);
        logger.info(`Agent ${agentVault} is waiting for destruction clean up before destroying.`);
        console.log(`Agent ${agentVault} is waiting for destruction clean up before destroying.`);
    }

    /**
     * Announces and performs agent's underlying withdrawal.
     * It marks in persistent state that underlying withdrawal has started and it is then
     * handled by methods 'handleTimelockedProcesses' and  'handleOpenUnderlyingPayments' in AgentBot.ts.
     * @param agentVault agent's vault address
     * @param amount amount to be transferred
     * @param destinationAddress underlying destination address
     */
    async withdrawUnderlying(agentVault: string, amount: string | BN, destinationAddress: string): Promise<string | null> {
        logger.info(`Agent ${agentVault} is trying to announce underlying withdrawal with amount ${amount.toString()} to destination ${destinationAddress}.`);
        try {
            const { agentBot } = await this.getAgentBot(agentVault);
            const announce = await agentBot.agent.announceUnderlyingWithdrawal();
            const latestBlock = await latestBlockTimestampBN();
            const txHash = await agentBot.agent.performPayment(destinationAddress, amount, announce.paymentReference);

            await agentBot.updateAgentEntity(this.orm.em, async (agentEnt) => {
                agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = latestBlock;
                agentEnt.underlyingWithdrawalConfirmTransaction = txHash;
            });

            await this.notifierFor(agentVault).sendUnderlyingWithdrawalPerformed(txHash, announce.paymentReference);
            logger.info(`Agent ${agentVault} performed underlying withdrawal ${amount} to ${destinationAddress} with reference ${announce.paymentReference} and txHash ${txHash}.`);
            return txHash;
        } catch (error) {
            logger.error(`Agent ${agentVault} is received error while announcing underlying withdrawal.`, error);
            console.error(error);
            return null;
        }
    }

    /**
     * Cancels agent's underlying withdrawal, if already allowed. Otherwise it marks in persistent state and it is then handled in AgentBot.ts.
     * @param agentVault agent's vault address
     */
    async cancelUnderlyingWithdrawal(agentVault: string): Promise<void> {
        logger.info(`Agent ${agentVault} is trying to cancel underlying withdrawal announcement.`);
        const { agentBot, readAgentEnt } = await this.getAgentBot(agentVault);
        const confirmationAllowedAt = await agentBot.underlyingWithdrawal.confirmationAllowedAt(readAgentEnt);
        if (confirmationAllowedAt != null) {
            logger.info(`Agent ${agentVault} is waiting for canceling underlying withdrawal.`);
            console.log(`Agent ${agentVault} is waiting for canceling underlying withdrawal.`);
            const latestTimestamp = await latestBlockTimestampBN();
            if (confirmationAllowedAt.lt(latestTimestamp)) {
                await agentBot.agent.cancelUnderlyingWithdrawal();
                logger.info(`Agent ${agentVault} canceled underlying withdrawal of tx ${readAgentEnt.underlyingWithdrawalConfirmTransaction}.`);
                await agentBot.updateAgentEntity(this.orm.em, async (agentEnt) => {
                    agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = BN_ZERO;
                });
                await this.notifierFor(agentVault).sendCancelWithdrawUnderlying();
            } else {
                await agentBot.updateAgentEntity(this.orm.em, async (agentEnt) => {
                    agentEnt.underlyingWithdrawalWaitingForCancelation = true;
                });
                logger.info(`Agent ${agentVault} cannot yet cancel underlying withdrawal. Allowed at ${confirmationAllowedAt}. Current ${latestTimestamp.toString()}.`);
                console.log(`Agent ${agentVault} cannot yet cancel underlying withdrawal. Allowed at ${confirmationAllowedAt}. Current ${latestTimestamp.toString()}.`);
            }
        } else {
            await this.notifierFor(agentVault).sendNoActiveWithdrawal();
            logger.info(`Agent ${agentVault} has no active underlying withdrawal announcement.`);
        }
    }

    /**
     * Lists active agents in owner's local db.
     */
    async listActiveAgents(): Promise<void> {
        const listOfAgents = await this.getAllActiveAgents();
        for (const agent of listOfAgents) {
            console.log(`Vault: ${agent.vaultAddress}, Pool: ${agent.collateralPoolAddress}, Underlying: ${agent.underlyingAddress}, Chain: ${decodeAttestationName(agent.chainId)}, FAsset: ${agent.fassetSymbol}, Current event block: ${agent.currentEventBlock} `);
        }
    }

    /**
     * Return all active agents belonging to this context's asset manager controller (on any asset manager).
     */
    async getAllActiveAgents() {
        const assetManagers = await this.context.assetManagerController.getAssetManagers();
        const query = this.orm.em.createQueryBuilder(AgentEntity);
        return await query.where({ active: true, assetManager: { $in: assetManagers } }).getResultList();
    }

    /**
     * Return all active agents belonging to this context's asset manager.
     */
    async getActiveAgentsForFAsset() {
        const query = this.orm.em.createQueryBuilder(AgentEntity);
        return await query.where({ active: true, assetManager: this.context.assetManager.address }).getResultList();
    }

    /**
     * Get agent info
     * @param agentVault agent's vault address
     */
    async printAgentInfo(agentVault: string, raw: boolean): Promise<void> {
        if (raw) {
            await this.infoBot().printRawAgentInfo(agentVault);
        } else {
            await this.infoBot().printAgentInfo(agentVault, this.owner, this.ownerUnderlyingAddress);
        }
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
    async getAgentBot(agentVault: string): Promise<{ agentBot: AgentBot; readAgentEnt: AgentEntity }> {
        const readAgentEnt = await this.fetchAgentEntity(agentVault);
        const agentBot = await AgentBot.fromEntity(this.context, this.agentBotSettings, readAgentEnt, this.ownerUnderlyingAddress, this.notifiers);
        return { agentBot, readAgentEnt };
    }

    /**
     * Return agent entity for given vault address.
     * @param agentVault agent's vault address
     */
    async fetchAgentEntity(agentVault: string): Promise<AgentEntity> {
        const agentEnt = await this.orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault });
        assertCmd(agentEnt.assetManager === this.context.assetManager.address, "Invalid agent vault address for current settings");
        return agentEnt;
    }

    /**
     * Delegates pool collateral.
     * @param agentVault agent's vault address
     * @param recipient address of the recipient
     * @param bips percentage of voting power to be delegated in bips
     */
    async delegatePoolCollateral(agentVault: string, recipient: string, bips: string | BN): Promise<void> {
        const { readAgentEnt } = await this.getAgentBot(agentVault);
        const collateralPool = await CollateralPool.at(readAgentEnt.collateralPoolAddress);
        await collateralPool.delegate(recipient, bips, { from: readAgentEnt.ownerAddress });
        const bipsFmt = formatBips(toBN(bips));
        await this.notifierFor(agentVault).sendDelegatePoolCollateral(collateralPool.address, recipient, bipsFmt);
        logger.info(`Agent ${agentVault} delegated pool collateral to ${recipient} with percentage ${bipsFmt}.`);
    }

    /**
     * Undelegates pool collateral.
     * @param agentVault agent's vault address
     */
    async undelegatePoolCollateral(agentVault: string): Promise<void> {
        const { readAgentEnt } = await this.getAgentBot(agentVault);
        const collateralPool = await CollateralPool.at(readAgentEnt.collateralPoolAddress);
        await collateralPool.undelegateAll({ from: readAgentEnt.ownerAddress });
        await this.notifierFor(agentVault).sendUndelegatePoolCollateral(collateralPool.address);
        logger.info(`Agent ${agentVault} undelegated all pool collateral.`);
    }

    /**
     * Creates underlying account
     * @returns object containing underlying address and its private key respectively
     */
    async createUnderlyingAccount(secrets: Secrets): Promise<{ address: string; privateKey: string }> {
        const address = await this.context.wallet.createAccount();
        const walletKeys = DBWalletKeys.from(this.orm.em, secrets);
        const privateKey = requireNotNull(await walletKeys.getKey(address));
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
        const free = info.freeVaultCollateralWei.toString();
        logger.info(`Agent ${agentVault} has free vault collateral ${free}.`);
        return free;
    }

    /**
     * Returns agent's free pool collateral
     * @param agentVault agent's vault address
     * @returns amount of free pool collateral
     */
    async getFreePoolCollateral(agentVault: string): Promise<string> {
        const { agentBot } = await this.getAgentBot(agentVault);
        const info = await agentBot.agent.getAgentInfo();
        const free = info.freePoolCollateralNATWei.toString();
        logger.info(`Agent ${agentVault} has free pool collateral ${free}.`);
        return free;
    }

    /**
     * Returns agent's free underlying
     * @param agentVault agent's vault address
     * @returns amount of free underlying
     */
    async getFreeUnderlying(agentVault: string): Promise<string> {
        const { agentBot } = await this.getAgentBot(agentVault);
        const info = await agentBot.agent.getAgentInfo();
        const free = info.freeUnderlyingBalanceUBA.toString();
        logger.info(`Agent ${agentVault} has free underlying  ${free}.`);
        return free;
    }

    /**
     * Switches vault collateral
     * @param agentVault agent's vault address
     * @param token vault collateral token address
     */
    async switchVaultCollateral(agentVault: string, token: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.switchVaultCollateral(token);
        logger.info(`Agent ${agentVault} switched vault collateral to ${token}.`);
    }

    /**
     * Switch vault collateral, but before that deposit the equivalent amount as the current balance.
     */
    async depositAndSwitchVaultCollateral(agentVault: string, token: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        const amountToDeposit = await agentBot.agent.calculateVaultCollateralReplacementAmount(token);
        await agentBot.agent.depositTokensToVault(token, amountToDeposit);
        await agentBot.agent.switchVaultCollateral(token);
        logger.info(`Agent ${agentVault} deposited and switched vault collateral to ${token}.`);
    }

    /**
     * Upgrades WNat contract
     * @param agentVault agent's vault address
     */
    async upgradeWNatContract(agentVault: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.upgradeWNatContract();
        logger.info(`Agent ${agentVault} upgraded wnat contract.`);
    }

    async validateCollateralPoolTokenSuffix(suffix: string) {
        const maxLength = 20;
        if (suffix.length >= maxLength) {
            throw new CommandLineError(`Collateral pool token suffix "${suffix}" is too long - maximum length is ${maxLength - 1}.`);
        }
        const validSyntax = /^[A-Z0-9-]+$/.test(suffix) && !suffix.startsWith("-") && !suffix.endsWith("-");
        if (!validSyntax) {
            throw new CommandLineError(`Collateral pool token suffix can contain only characters 'A'-'Z', '0'-'9' and '-', and cannot start or end with '-'.`);
        }
        if (await this.context.assetManager.isPoolTokenSuffixReserved(suffix)) {
            throw new CommandLineError(`Agent vault with collateral pool token suffix "${suffix}" already exists.`);
        }
    }

    async makeIllegalPayment(agentVault: string, destination: string, amount: string | BN): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.performPayment(destination, amount);
        console.log(`made an illegal payment of ${amount} to ${destination} from ${agentVault}`);
    }
}
