import "dotenv/config";

import { AddressValidity, decodeAttestationName } from "@flarenetwork/state-connector-protocol";
import { FilterQuery } from "@mikro-orm/core";
import BN from "bn.js";
import chalk from "chalk";
import { InfoBot } from "..";
import { AgentBot } from "../actors/AgentBot";
import { AgentVaultInitSettings, createAgentVaultInitSettings } from "../config/AgentVaultInitSettings";
import { closeBotConfig, createBotConfig } from "../config/BotConfig";
import { loadAgentConfigFile } from "../config/config-file-loader";
import { AgentSettingsConfig, Schema_AgentSettingsConfig } from "../config/config-files/AgentSettingsConfig";
import { createAgentBotContext } from "../config/create-asset-context";
import { decodedChainId } from "../config/create-wallet-client";
import { ORM } from "../config/orm";
import { Secrets } from "../config/secrets";
import { AgentEntity } from "../entities/agent";
import { IAssetAgentContext } from "../fasset-bots/IAssetBotContext";
import { Agent, OwnerAddressPair } from "../fasset/Agent";
import { AgentSettings, CollateralClass } from "../fasset/AssetManagerTypes";
import { DBWalletKeys } from "../underlying-chain/WalletKeys";
import { resolveInFassetBotsCore, squashSpace } from "../utils";
import { CommandLineError, assertNotNullCmd } from "../utils/command-line-errors";
import { getAgentSettings, proveAndUpdateUnderlyingBlock } from "../utils/fasset-helpers";
import { BN_ZERO, ZERO_ADDRESS, ZERO_BYTES32, errorIncluded, requireNotNull, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";
import { NotifierTransport } from "../utils/notifier/BaseNotifier";
import { artifacts, authenticatedHttpProvider, initWeb3 } from "../utils/web3";
import { latestBlockTimestampBN } from "../utils/web3helpers";

const CollateralPool = artifacts.require("CollateralPool");
const IERC20 = artifacts.require("IERC20Metadata");

type CleanupRegistration = (handler: () => Promise<void>) => void;

export class AgentBotCommands {
    static deepCopyWithObjectCreate = true;

    constructor(
        public secrets: Secrets,
        public context: IAssetAgentContext,
        public owner: OwnerAddressPair,
        public orm: ORM,
        public notifiers: NotifierTransport[],
    ) {}

    /**
     * Creates instance of BotCliCommands.
     * @param runConfigFile path to configuration file
     * @param fAssetSymbol symbol for the fasset
     * @returns instance of BotCliCommands class
     */
    static async create(secretsFile: string, runConfigFile: string, fAssetSymbol: string, registerCleanup?: CleanupRegistration) {
        const secrets = Secrets.load(secretsFile);
        const owner = new OwnerAddressPair(secrets.required("owner.management.address"), secrets.required("owner.native.address"));
        // load config
        logger.info(`Owner ${owner.managementAddress} started to initialize cli environment.`);
        console.log(chalk.cyan("Initializing environment..."));
        const runConfig = loadAgentConfigFile(runConfigFile, `Owner ${owner.managementAddress}`);
        // init web3 and accounts
        const nativePrivateKey = secrets.required("owner.native.private_key");
        const apiKey = secrets.optional("apiKey.native_rpc");
        const accounts = await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, apiKey), [nativePrivateKey], null);
        /* istanbul ignore next */
        if (owner.workAddress !== accounts[0]) {
            logger.error(`Owner ${owner.managementAddress} has invalid address/private key pair.`);
            throw new Error("Invalid address/private key pair");
        }
        // create config
        const botConfig = await createBotConfig("agent", secrets, runConfig, owner.workAddress);
        registerCleanup?.(() => closeBotConfig(botConfig));
        // create context
        const chainConfig = botConfig.fAssets.get(fAssetSymbol);
        assertNotNullCmd(chainConfig, `Invalid FAsset symbol ${fAssetSymbol}`);
        const context = await createAgentBotContext(botConfig, chainConfig);
        // verify keys
        await this.verifyWorkAddress(context, owner);
        // create underlying wallet key
        const underlyingAddress = secrets.required(`owner.${decodedChainId(chainConfig.chainInfo.chainId)}.address`);
        const underlyingPrivateKey = secrets.required(`owner.${decodedChainId(chainConfig.chainInfo.chainId)}.private_key`);
        await context.wallet.addExistingAccount(underlyingAddress, underlyingPrivateKey);
        console.log(chalk.cyan("Environment successfully initialized."));
        logger.info(`Owner ${owner.managementAddress} successfully finished initializing cli environment.`);
        return new AgentBotCommands(secrets, context, owner, requireNotNull(botConfig.orm), botConfig.notifiers);
    }

    static async verifyWorkAddress(context: IAssetAgentContext, owner: OwnerAddressPair) {
        // get work address
        const chainWorkAddress = await Agent.getOwnerWorkAddress(context, owner.managementAddress);
        // ensure that work address is defined and matches the one from secrets.json
        if (chainWorkAddress === ZERO_ADDRESS) {
            throw new CommandLineError(`Management address ${owner.managementAddress} has no registered work address.`);
        } else if (chainWorkAddress !== owner.workAddress) {
            throw new CommandLineError(squashSpace`Work address ${chainWorkAddress} registered by management address ${owner.managementAddress}
                does not match the owner.native address ${owner.workAddress} from your secrets file.`);
        }
    }

    notifierFor(agentVault: string) {
        return new AgentNotifier(agentVault, this.notifiers);
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
            const underlyingAddress = await AgentBot.createUnderlyingAddress(this.orm.em, this.context);
            console.log(`Validating new underlying address ${underlyingAddress}...`);
            console.log(`Owner ${this.owner} validating new underlying address ${underlyingAddress}.`);
            const ownerUnderlyingAddress = AgentBot.underlyingAddress(this.secrets, this.context.chainInfo.chainId);
            const [addressValidityProof, _] = await Promise.all([

                AgentBot.initializeUnderlyingAddress(this.context, this.owner, ownerUnderlyingAddress, underlyingAddress),
                proveAndUpdateUnderlyingBlock(this.context.attestationProvider, this.context.assetManager, this.owner.workAddress),
            ]);
            console.log(`Creating agent bot...`);
            const agentBotSettings: AgentVaultInitSettings = await createAgentVaultInitSettings(this.context, agentSettings);
            const agentBot = await AgentBot.create(this.orm.em, this.context, this.owner, ownerUnderlyingAddress, addressValidityProof, agentBotSettings, this.notifiers);
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
     * Deposits class 1 collateral to agent's vault from owner.
     * @param agentVault agent's vault address
     * @param amount amount to be deposited
     */
    async depositToVault(agentVault: string, amount: string | BN): Promise<void> {
        logger.info(`Agent's ${agentVault} owner ${this.owner} is starting vault collateral deposit ${amount}.`);
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.depositVaultCollateral(amount);
        await this.notifierFor(agentVault).sendVaultCollateralDeposit(amount);
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
        await this.notifierFor(agentVault).sendBuyCollateralPoolTokens(amount);
        logger.info(`Agent's ${agentVault} owner ${this.owner} bought collateral pool tokens ${amount}.`);
    }

    /**
     * Enters agent to available list, so agent can be minted against.
     * @param agentVault agent's vault address
     */
    async enterAvailableList(agentVault: string): Promise<void> {
        const { agentBot } = await this.getAgentBot(agentVault);
        await agentBot.agent.makeAvailable();
        await this.notifierFor(agentVault).sendAgentEnteredAvailable();
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
        await this.orm.em.persistAndFlush(agentEnt);
        await this.notifierFor(agentVault).sendAgentAnnouncedExitAvailable();
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
        await this.notifierFor(agentVault).sendWithdrawVaultCollateralAnnouncement(amount);
        agentEnt.withdrawalAllowedAtTimestamp = withdrawalAllowedAt;
        agentEnt.withdrawalAllowedAtAmount = String(amount);
        await this.orm.em.persistAndFlush(agentEnt);
        logger.info(`Agent ${agentVault} announced vault collateral withdrawal ${amount} at ${withdrawalAllowedAt.toString()}.`);
    }

    /**
     * Cancels agent's vault collateral announcement.
     * @param agentVault agent's vault address
     */
    async cancelWithdrawFromVaultAnnouncement(agentVault: string): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        await agentBot.agent.announceVaultCollateralWithdrawal(BN_ZERO);
        await this.notifierFor(agentVault).sendCancelVaultCollateralAnnouncement();
        agentEnt.withdrawalAllowedAtTimestamp = BN_ZERO;
        agentEnt.withdrawalAllowedAtAmount = "";
        await this.orm.em.persistAndFlush(agentEnt);
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
        await this.notifierFor(agentVault).sendRedeemCollateralPoolTokensAnnouncement(amount);
        agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp = withdrawalAllowedAt;
        agentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount = String(amount);
        await this.orm.em.persistAndFlush(agentEnt);
        logger.info(`Agent ${agentVault} announced pool token redemption of ${amount} at ${withdrawalAllowedAt.toString()}.`);
    }

    /**
     * Cancels agent's pool token redemption announcement.
     * @param agentVault agent's vault address
     */
    async cancelCollateralPoolTokensAnnouncement(agentVault: string): Promise<void> {
        const { agentBot, agentEnt } = await this.getAgentBot(agentVault);
        await agentBot.agent.announceVaultCollateralWithdrawal(BN_ZERO);
        await this.notifierFor(agentVault).sendCancelRedeemCollateralPoolTokensAnnouncement();
        agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp = BN_ZERO;
        agentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount = "";
        await this.orm.em.persistAndFlush(agentEnt);
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
        await this.notifierFor(agentVault).sendWithdrawPoolFees(amount);
        logger.info(`Agent ${agentVault} withdrew pool fees ${amount}.`);
    }

    /**
     * Returns agent's pool fee balance.
     * @param agentVault agent's vault address
     */
    async poolFeesBalance(agentVault: string): Promise<string> {
        const { agentBot } = await this.getAgentBot(agentVault);
        const balance = await agentBot.agent.poolFeeBalance();
        await this.notifierFor(agentVault).sendBalancePoolFees(balance.toString());
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
        await this.notifierFor(agentVault).sendSelfClose();
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
        await this.orm.em.persistAndFlush(agentEnt);
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
        const agentEnt = await this.orm.em.getRepository(AgentEntity).findOneOrFail({ vaultAddress: agentVault } as FilterQuery<AgentEntity>);
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
            await this.orm.em.persistAndFlush(agentEnt);
            await this.notifierFor(agentVault).sendAnnounceUnderlyingWithdrawal(announce.paymentReference);
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
        await this.orm.em.persistAndFlush(agentEnt);
        await this.notifierFor(agentVault).sendUnderlyingWithdrawalPerformed(txHash);
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
                await this.orm.em.persistAndFlush(agentEnt);
                await this.notifierFor(agentVault).sendConfirmWithdrawUnderlying();
            } else {
                logger.info(`Agent ${agentVault} cannot yet confirm underlying withdrawal. Allowed at ${toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).add(announcedUnderlyingConfirmationMinSeconds).toString()}. Current ${latestTimestamp.toString()}.`);
                console.log(`Agent ${agentVault} cannot yet confirm underlying withdrawal. Allowed at ${toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).add(announcedUnderlyingConfirmationMinSeconds).toString()}. Current ${latestTimestamp.toString()}.`);
            }
        } else {
            await this.notifierFor(agentVault).sendNoActiveWithdrawal();
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
                await this.orm.em.persistAndFlush(agentEnt);
                await this.notifierFor(agentVault).sendCancelWithdrawUnderlying();
            } else {
                agentEnt.underlyingWithdrawalWaitingForCancelation = true;
                await this.orm.em.persistAndFlush(agentEnt);
                logger.info(`Agent ${agentVault} cannot yet cancel underlying withdrawal. Allowed at ${toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).add(announcedUnderlyingConfirmationMinSeconds).toString()}. Current ${latestTimestamp.toString()}.`);
                console.log(`Agent ${agentVault} cannot yet cancel underlying withdrawal. Allowed at ${toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).add(announcedUnderlyingConfirmationMinSeconds).toString()}. Current ${latestTimestamp.toString()}.`);
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
        const query = this.orm.em.createQueryBuilder(AgentEntity);
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
        const agentEnt = await this.orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const ownerUnderlyingAddress = AgentBot.underlyingAddress(this.secrets, this.context.chainInfo.chainId);
        const agentBot = await AgentBot.fromEntity(this.context, agentEnt, ownerUnderlyingAddress, this.notifiers);
        return { agentBot, agentEnt };
    }

    /**
     * Delegates pool collateral.
     * @param agentVault agent's vault address
     * @param recipient address of the recipient
     * @param bips percentage of voting power to be delegated in bips
     */
    async delegatePoolCollateral(agentVault: string, recipient: string, bips: string | BN): Promise<void> {
        const agentEnt = await this.orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const collateralPool = await CollateralPool.at(agentEnt.collateralPoolAddress);
        await collateralPool.delegate(recipient, bips, { from: agentEnt.ownerAddress });
        await this.notifierFor(agentVault).sendDelegatePoolCollateral(collateralPool.address, recipient, bips);
        logger.info(`Agent ${agentVault} delegated pool collateral to ${recipient} with bips ${bips}.`);
    }

    /**
     * Undelegates pool collateral.
     * @param agentVault agent's vault address
     */
    async undelegatePoolCollateral(agentVault: string): Promise<void> {
        const agentEnt = await this.orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVault } as FilterQuery<AgentEntity>);
        const collateralPool = await CollateralPool.at(agentEnt.collateralPoolAddress);
        await collateralPool.undelegateAll({ from: agentEnt.ownerAddress });
        await this.notifierFor(agentVault).sendUndelegatePoolCollateral(collateralPool.address);
        logger.info(`Agent ${agentVault} undelegated all pool collateral.`);
    }

    /**
     * Creates underlying account
     * @returns object containing underlying address and its private key respectively
     */
    async createUnderlyingAccount(): Promise<{ address: string; privateKey: string }> {
        const address = await this.context.wallet.createAccount();
        const walletKeys = DBWalletKeys.from(this.orm.em, this.secrets);
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
