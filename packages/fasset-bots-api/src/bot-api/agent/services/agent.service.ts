import { ActivityTimestampEntity, AgentBotCommands, AgentEntity, AgentSettingName, AgentStatus, AgentUpdateSettingState, CollateralClass, InfoBotCommands, TokenPriceReader, generateSecrets } from "@flarelabs/fasset-bots-core";
import { AgentSettingsConfig, Secrets, createBotOrm, loadAgentConfigFile, loadConfigFile } from "@flarelabs/fasset-bots-core/config";
import { BN_ZERO, BNish, Currencies, MAX_BIPS, TokenBalances, artifacts, createSha256Hash, formatFixed, generateRandomHexString, requireEnv, resolveInFassetBotsCore, toBN, toBNExp, web3 } from "@flarelabs/fasset-bots-core/utils";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Inject, Injectable } from "@nestjs/common";
import { Cache } from "cache-manager";
import { PostAlert } from "../../../../../fasset-bots-core/src/utils/notifier/NotifierTransports";
import { APIKey, AgentBalance, AgentCreateResponse, AgentData, AgentSettings, AgentUnderlying, AgentVaultStatus, AllCollaterals, AllVaults, CollateralTemplate, ExtendedAgentVaultInfo, VaultCollaterals, VaultInfo, requiredKeysForSecrets } from "../../common/AgentResponse";
import * as fs from 'fs';
import Web3 from "web3";
import { AgentSettingsDTO } from "../../common/AgentSettingsDTO";
import { allTemplate } from "../../common/VaultTemplates";
import { SecretsFile } from "../../../../../fasset-bots-core/src/config/config-files/SecretsFile";
import { EntityManager } from "@mikro-orm/core";
import { Alert } from "../../common/entities/AlertDB";
import { ORM } from "../../../../../fasset-bots-core/src/config/orm";
import BN from "bn.js";
import { cachedSecrets } from "../agentServer";

const IERC20 = artifacts.require("IERC20Metadata");
const CollateralPool = artifacts.require("CollateralPool");
const CollateralPoolToken = artifacts.require("CollateralPoolToken");
const IERC20Metadata = artifacts.require("IERC20Metadata");

const FASSET_BOT_CONFIG: string = requireEnv("FASSET_BOT_CONFIG");
// const FASSET_BOT_SECRETS: string = requireEnv("FASSET_BOT_SECRETS");

@Injectable()
export class AgentService {
    public orm!: ORM;
    public secrets!: Secrets;
    constructor(
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        private readonly em: EntityManager,
    ) {
    }

    async onModuleInit() {
        const configFile = loadAgentConfigFile(FASSET_BOT_CONFIG, `Backend`);
        this.secrets = cachedSecrets;
        this.orm = await createBotOrm("agent", configFile.ormOptions, this.secrets.data.database) as ORM;
    }

    async createAgent(fAssetSymbol: string, agentSettings: AgentSettingsConfig): Promise<AgentCreateResponse | null> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        const agent = await cli.createAgentVault(agentSettings);
        if (agent) {
            return {
                vaultAddress: agent.vaultAddress,
                ownerAddress: agent.owner.managementAddress,
                collateralPoolAddress: agent.collateralPool.address,
                collateralPoolTokenAddress: agent.collateralPoolToken.address,
                underlyingAddress: agent.underlyingAddress,
            };
        }
        return null;
    }

    async depositToVault(fAssetSymbol: string, agentVaultAddress: string, amount: string): Promise<void> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        const currency = await Currencies.agentVaultCollateral(cli.context, agentVaultAddress);
        await cli.depositToVault(agentVaultAddress, currency.parse(amount));
    }

    async withdrawVaultCollateral(fAssetSymbol: string, agentVaultAddress: string, amount: string): Promise<void> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        const currency = await Currencies.agentVaultCollateral(cli.context, agentVaultAddress);
        await cli.announceWithdrawFromVault(agentVaultAddress, currency.parse(amount));
    }

    async closeVault(fAssetSymbol: string, agentVaultAddress: string): Promise<void> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.closeVault(agentVaultAddress);
    }

    async selfClose(fAssetSymbol: string, agentVaultAddress: string, amountUBA: string): Promise<void> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        const currency = await Currencies.fasset(cli.context);
        await cli.selfClose(agentVaultAddress, currency.parse(amountUBA));
    }

    async buyPoolCollateral(fAssetSymbol: string, agentVaultAddress: string, amount: string): Promise<void> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        const currency = await Currencies.agentPoolCollateral(cli.context, agentVaultAddress);
        await cli.buyCollateralPoolTokens(agentVaultAddress, currency.parse(amount));
    }

    async withdrawPoolFees(fAssetSymbol: string, agentVaultAddress: string, amount: string): Promise<void> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.withdrawPoolFees(agentVaultAddress, amount);
    }

    async poolFeesBalance(fAssetSymbol: string, agentVaultAddress: string): Promise<AgentBalance> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        const balance = await cli.poolFeesBalance(agentVaultAddress);
        return { balance };
    }

    async withdrawPoolCollateral(fAssetSymbol: string, agentVaultAddress: string, amount: string): Promise<void> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        const currency = await Currencies.agentPoolCollateral(cli.context, agentVaultAddress);
        await cli.announceRedeemCollateralPoolTokens(agentVaultAddress, currency.parse(amount));
    }

    async poolTokenBalance(fAssetSymbol: string, agentVaultAddress: string): Promise<AgentBalance> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        const info = await cli.context.assetManager.getAgentInfo(agentVaultAddress);
        const poolToken = await CollateralPoolToken.at(info.collateralPoolToken);
        const balance = await poolToken.balanceOf(agentVaultAddress);
        const currency = await Currencies.agentPoolCollateral(cli.context, agentVaultAddress);
        const amount = currency.formatValue(balance);
        return { balance: amount };
    }

    async freePoolCollateral(fAssetSymbol: string, agentVaultAddress: string): Promise<AgentBalance> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        const balance = await cli.getFreePoolCollateral(agentVaultAddress);
        const currency = await Currencies.agentPoolCollateral(cli.context, agentVaultAddress);
        const amount = currency.formatValue(balance);
        return { balance: amount };
    }

    async getFreeVaultCollateral(fAssetSymbol: string, agentVaultAddress: string): Promise<AgentBalance> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        const balance = await cli.getFreeVaultCollateral(agentVaultAddress);
        const currency = await Currencies.agentVaultCollateral(cli.context, agentVaultAddress);
        const amount = currency.formatValue(balance);
        return { balance: amount };
    }

    async delegatePoolCollateral(fAssetSymbol: string, agentVaultAddress: string, recipientAddress: string, bips: string): Promise<void> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.delegatePoolCollateral(agentVaultAddress, recipientAddress, bips);
    }

    async undelegatePoolCollateral(fAssetSymbol: string, agentVaultAddress: string): Promise<void> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.undelegatePoolCollateral(agentVaultAddress);
    }

    async enterAvailable(fAssetSymbol: string, agentVaultAddress: string): Promise<void> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.enterAvailableList(agentVaultAddress);
    }

    async announceExitAvailable(fAssetSymbol: string, agentVaultAddress: string): Promise<void> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.announceExitAvailableList(agentVaultAddress);
    }

    async exitAvailable(fAssetSymbol: string, agentVaultAddress: string): Promise<void> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.exitAvailableList(agentVaultAddress);
    }

    async withdrawUnderlying(fAssetSymbol: string, agentVaultAddress: string, amount: string, destinationAddress: string,): Promise<AgentUnderlying> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        const transactionDatabaseId = await cli.withdrawUnderlying(agentVaultAddress, amount, destinationAddress);
        return {
            transactionDatabaseId: transactionDatabaseId || null,
        };
    }

    async cancelUnderlyingWithdrawal(fAssetSymbol: string, agentVaultAddress: string): Promise<void> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.cancelUnderlyingWithdrawal(agentVaultAddress);
    }

    async getFreeUnderlying(fAssetSymbol: string, agentVaultAddress: string): Promise<AgentBalance> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        const balance = await cli.getFreeUnderlying(agentVaultAddress);
        return {
            balance,
        };
    }

    async listAgentSetting(fAssetSymbol: string, agentVaultAddress: string): Promise<AgentSettings> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        const settings = await cli.printAgentSettings(agentVaultAddress);
        const result = {} as AgentSettings;
        const vaultCollateral = await IERC20.at(settings.vaultCollateralToken);
        const vcSymbol = await vaultCollateral.symbol();
        result.vaultCollateralToken = settings.vaultCollateralToken;
        result.vaultCollateralSymbol = vcSymbol;
        result.feeBIPS = settings.feeBIPS.toString();
        result.poolFeeShareBIPS = settings.poolFeeShareBIPS.toString();
        result.mintingVaultCollateralRatioBIPS = settings.mintingVaultCollateralRatioBIPS.toString();
        result.mintingPoolCollateralRatioBIPS = settings.mintingPoolCollateralRatioBIPS.toString();
        result.poolExitCollateralRatioBIPS = settings.poolExitCollateralRatioBIPS.toString();
        result.buyFAssetByAgentFactorBIPS = settings.buyFAssetByAgentFactorBIPS.toString();
        result.poolTopupCollateralRatioBIPS = settings.poolTopupCollateralRatioBIPS.toString();
        result.poolTopupTokenPriceFactorBIPS = settings.poolTopupTokenPriceFactorBIPS.toString();
        return result;
    }

    async updateAgentSetting(fAssetSymbol: string, agentVaultAddress: string, settingName: string, settingValue: string): Promise<void> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.updateAgentSetting(agentVaultAddress, settingName, settingValue);
    }

    async updateAgentSettings(fAssetSymbol: string, agentVaultAddress: string, settings: AgentSettingsDTO[]): Promise<void> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        const currentSettings: any = await cli.printAgentSettings(agentVaultAddress);
        for (const setting of settings) {
            if(parseInt(currentSettings[setting.name], 10) != parseInt(setting.value, 10)){
                await cli.updateAgentSetting(agentVaultAddress, setting.name, setting.value);
            }
        }
    }

    async createUnderlying(fAssetSymbol: string): Promise<AgentUnderlying> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        const account = await cli.createUnderlyingAccount(this.secrets);
        return { address: account.address, privateKey: account.privateKey };
    }

    async switchVaultCollateral(fAssetSymbol: string, agentVaultAddress: string, tokenAddress: string): Promise<void> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.switchVaultCollateral(agentVaultAddress, tokenAddress);
    }

    async upgradeWNat(fAssetSymbol: string, agentVaultAddress: string): Promise<void> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.upgradeWNatContract(agentVaultAddress);
    }

    async getAgentInfo(fAssetSymbol: string): Promise<AgentData> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        // get collateral data
        const collateralTypes = await cli.context.assetManager.getCollateralTypes();
        const collaterals = [];
        for (const collateralType of collateralTypes) {
            if (Number(collateralType.validUntil) != 0){
                continue;
              }
            const symbol = collateralType.tokenFtsoSymbol;
            const token = await IERC20.at(collateralType.token);
            const balance = await token.balanceOf(cli.owner.workAddress);
            const decimals = (await token.decimals()).toNumber();
            const collateral = { symbol, balance: formatFixed(toBN(balance), decimals, { decimals: 3, groupDigits: true, groupSeparator: ","  }) } as any;
            if (symbol === "CFLR" || symbol === "C2FLR" || symbol === "SGB" || symbol == "FLR") {
                const nonWrappedBalance = await web3.eth.getBalance(cli.owner.workAddress);
                collateral.wrapped = collateral.balance;
                collateral.balance = formatFixed(toBN(nonWrappedBalance), decimals, { decimals: 3, groupDigits: true, groupSeparator: "," });
            }
            collaterals.push(collateral);
        }
        // get is whitelisted
        const whitelisted = await cli.context.agentOwnerRegistry.isWhitelisted(cli.owner.managementAddress);
        return { collaterals, whitelisted };
    }

    async getAgentVaultsInfo(fAssetSymbol: string): Promise<AgentVaultStatus[]> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        // get agent infos
        const agentVaults = await cli.getAllActiveAgents();

        const agentInfos: AgentVaultStatus[] = [];
        for (const agent of agentVaults) {
            await agent.updateSettings.init()
            const agentInfo = await cli.context.assetManager.getAgentInfo(agent.vaultAddress);
            agentInfos.push({
                vaultAddress: agent.vaultAddress,
                poolCollateralRatioBIPS: agentInfo.poolCollateralRatioBIPS.toString(),
                vaultCollateralRatioBIPS: agentInfo.vaultCollateralRatioBIPS.toString(),
                agentSettingUpdateValidAtFeeBIPS: this.getUpdateSettingValidAtTimestamp(agent, AgentSettingName.FEE),
                agentSettingUpdateValidAtPoolFeeShareBIPS: this.getUpdateSettingValidAtTimestamp(agent, AgentSettingName.POOL_FEE_SHARE),
                agentSettingUpdateValidAtMintingVaultCrBIPS: this.getUpdateSettingValidAtTimestamp(agent, AgentSettingName.MINTING_VAULT_CR),
                agentSettingUpdateValidAtMintingPoolCrBIPS: this.getUpdateSettingValidAtTimestamp(agent, AgentSettingName.MINTING_POOL_CR),
                agentSettingUpdateValidAtBuyFAssetByAgentFactorBIPS: this.getUpdateSettingValidAtTimestamp(agent, AgentSettingName.BUY_FASSET_FACTOR),
                agentSettingUpdateValidAtPoolExitCrBIPS: this.getUpdateSettingValidAtTimestamp(agent, AgentSettingName.POOL_EXIT_CR),
                agentSettingUpdateValidAtPoolTopupCrBIPS: this.getUpdateSettingValidAtTimestamp(agent, AgentSettingName.POOL_TOP_UP_CR),
                agentSettingUpdateValidAtPoolTopupTokenPriceFactorBIPS: this.getUpdateSettingValidAtTimestamp(agent, AgentSettingName.POOL_TOP_UP_TOKEN_PRICE_FACTOR)
            })
        }
        return agentInfos
    }

    getUpdateSettingValidAtTimestamp(agent: AgentEntity, settingName: AgentSettingName): string {
        const found = agent.updateSettings.getItems().find(setting =>
            setting.name == settingName && setting.state === AgentUpdateSettingState.WAITING);
            if (found) {
                return found.validAt.toString();
            } else {
                return BN_ZERO.toString();
            }
    }

    async getAgentVaultInfo(fAssetSymbol: string, agentVaultAddress: string): Promise<ExtendedAgentVaultInfo> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        const info = await cli.context.assetManager.getAgentInfo(agentVaultAddress);
        const collateralToken = await cli.context.assetManager.getCollateralType(2,info.vaultCollateralToken);
        const agentVaultInfo: any = {};
        const pool = await CollateralPool.at(info.collateralPool);
        const poolToken = await IERC20Metadata.at(await pool.poolToken());
        const tokenSymbol = await poolToken.symbol();
        for (const key of Object.keys(info)) {
            if (!isNaN(parseInt(key))) continue;
            const value = info[key as keyof typeof info];
            const modified = (typeof value === "boolean") ? value : value.toString();
            agentVaultInfo[key as keyof typeof info] = modified;
        }
        agentVaultInfo.vaultCollateralToken = collateralToken.tokenFtsoSymbol;
        agentVaultInfo.poolSuffix = tokenSymbol;
        return agentVaultInfo;
    }

    async getAgentUnderlyingBalance(fAssetSymbol: string): Promise<AgentBalance> {
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        const balance = await cli.context.wallet.getBalance(cli.ownerUnderlyingAddress);
        return { balance: balance.toString() };
    }

    async saveAlert(notification: PostAlert): Promise<void> {
        // Currently delete alerts that are older than 5 days
        /*
        if(notification.title == "MINTING STARTED" || notification.title == "MINTING EXECUTED" || notification.title == "REDEMPTION STARTED" ||
            notification.title == "REDEMPTION PAID" || notification.title == "REDEMPTION PAYMENT PROOF REQUESTED" || notification.title == "REDEMPTION WAS PERFORMED"){
            return;
        }
        */
        const alert = new Alert(notification, Date.now()+ (5 * 24 * 60 * 60 * 1000), Date.now());
        await this.deleteExpiredAlerts();
        await this.em.persistAndFlush(alert);
    }

    async deleteExpiredAlerts(): Promise<void> {
        const expiredAlerts = await this.em.find(Alert, { expiration: { $lt: Date.now() } });
        for (const expiredAlert of expiredAlerts) {
            this.em.remove(expiredAlert);
        }
        await this.em.flush();
      }

    async getAlerts(): Promise<any[]> {
        const alertRepository = this.em.getRepository(Alert);
        const alerts = (await alertRepository.findAll()) as Alert[];
        const postAlerts: any[] = alerts.map((alert: Alert) => {
            return {
              alert: JSON.parse(alert.alert as any),
              date: alert.date
            };
        });
        return postAlerts;
    }

    async getAgentWorkAddress(): Promise<string> {
        return this.secrets.required("owner.native.address");
    }

    async getAgentManagementAddress(): Promise<string> {
        return this.secrets.required("owner.management.address");
    }

    async getFassetSymbols(): Promise<string[]> {
        const config = loadConfigFile(FASSET_BOT_CONFIG)
        const fassets: string[] = [];
        Object.entries(config.fAssets).forEach(([key, asset]) => {
            fassets.push(key);
        });
        return fassets;
    }

    async checkWhitelisted(): Promise<boolean> {
        const fassets = await this.getFassetSymbols();
        const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fassets[0]);
        const whitelisted = await cli.context.agentOwnerRegistry.isWhitelisted(cli.owner.managementAddress);
        return whitelisted;
    }

    async checkSecretsFile(): Promise<boolean> {
        const FASSET_BOT_SECRETS: string = requireEnv("FASSET_BOT_SECRETS");
        try {
            await fs.promises.access(FASSET_BOT_SECRETS, fs.constants.F_OK);
            return true;
          } catch (err: any) {
            if (err.code === 'ENOENT') {
              return false;
            } else {
              throw err;
            }
        }
    }

    async getAllCollaterals(): Promise<AllCollaterals[]> {
        const fassets = await this.getFassetSymbols();
        const collaterals: AllCollaterals[] = [];
        for (const fasset of fassets) {
            const agentInfo = await this.getAgentInfo(fasset);
            const collateral: AllCollaterals = { fassetSymbol: fasset, collaterals: agentInfo.collaterals };
            collaterals.push(collateral);
            break; //Might need to delete this if different collaterals for different fassets.
        }
        return collaterals;
    }

    async generateWorkAddress(): Promise<any> {
        const web3 = new Web3();
        const account = web3.eth.accounts.create();
        return account;
    }

    async checkBotStatus(): Promise<boolean> {
        const query = this.orm.em.createQueryBuilder(ActivityTimestampEntity);
        const result = await query.limit(1).getSingleResult();
        if (result == null) {
            return false;
        }
        if ((toBN(result?.lastActiveTimestamp as BN).toNumber()) * 1000 >= (Date.now() - 120000)) {
            return true;
        }
        return false;
    }

    async generateAPIKey(): Promise<APIKey> {
        const apiKey = generateRandomHexString(32);
        const hash = createSha256Hash(apiKey);
        return {key: apiKey, hash: hash};
    }

    async getVaultCollateralTokens(): Promise<VaultCollaterals[]> {
        const fassets = await this.getFassetSymbols();
        const collaterals: VaultCollaterals[] = [];
        const botConfig = await AgentBotCommands.createBotConfig(this.secrets, FASSET_BOT_CONFIG);
        for (const fasset of fassets) {
            const cli = await AgentBotCommands.createBotCommands(botConfig, fasset);
            // get collateral data
            const collateralTypes = await cli.context.assetManager.getCollateralTypes();
            const collateralTokens: CollateralTemplate[] = [];
            for (const collateralType of collateralTypes) {
                if (Number(collateralType.validUntil) != 0){
                    continue;
                  }
                const symbol = collateralType.tokenFtsoSymbol;
                const collateralClass = collateralType.collateralClass;
                if (collateralClass == toBN(2)) {
                    const template = JSON.stringify(allTemplate);
                    collateralTokens.push({symbol: symbol, template: template});
                }
            }
            const collateral: VaultCollaterals = { fassetSymbol: fasset, collaterals: collateralTokens };
            collaterals.push(collateral);
        }
        return collaterals;
    }


    async getAgentVaultInfoFull(agentVaultAddress: string, cli: AgentBotCommands): Promise<ExtendedAgentVaultInfo> {
        const info = await cli.context.assetManager.getAgentInfo(agentVaultAddress);
        const collateralToken = await cli.context.assetManager.getCollateralType(2,info.vaultCollateralToken);
        const agentVaultInfo: any = {};
        const pool = await CollateralPool.at(info.collateralPool);
        const poolToken = await IERC20Metadata.at(await pool.poolToken());
        const tokenSymbol = await poolToken.symbol();
        for (const key of Object.keys(info)) {
            if (!isNaN(parseInt(key))) continue;
            const value = info[key as keyof typeof info];
            const modified = (typeof value === "boolean") ? value : value.toString();
            agentVaultInfo[key as keyof typeof info] = modified;
        }
        agentVaultInfo.vaultCollateralToken = collateralToken.tokenFtsoSymbol;
        agentVaultInfo.poolSuffix = tokenSymbol;
        return agentVaultInfo;
    }

    /*
    *  Get info for all vaults for all fassets.
    */
    async getAgentVaults(): Promise<any> {
        const config = loadConfigFile(FASSET_BOT_CONFIG)
        const allVaults: AllVaults[] = [];
        function formatCR(bips: BNish) {
            if (String(bips) === "10000000000") return "<inf>";
            return formatFixed(toBN(bips), 4);
        }
        // eslint-disable-next-line guard-for-in
        for (const fasset in config.fAssets) {
            const cli = await AgentBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fasset);
            const collateralTypes = await cli.context.assetManager.getCollateralTypes();
            // Get agent vaults for fasset from database
            const agentVaults = await cli.getActiveAgentsForFAsset();
            if (agentVaults.length == 0){
                continue;
            }
            const settings = await cli.context.assetManager.getSettings();
            const priceReader = await TokenPriceReader.create(settings);
            const cflrPrice = await priceReader.getPrice("CFLR", false, settings.maxTrustedPriceAgeSeconds);
            const priceUSD = cflrPrice.price.mul(toBNExp(1, 18));
            const prices = [{ symbol: "CFLR", price: priceUSD, decimals: Number(cflrPrice.decimals) }];

            const lotSize = Number(settings.lotSizeAMG) * Number(settings.assetMintingGranularityUBA);
            const vaultsForFasset: VaultInfo[] = [];
            // For each vault calculate needed info
            for (const vault of agentVaults) {
                await vault.updateSettings.init()
                let updating = false;
                if (toBN(this.getUpdateSettingValidAtTimestamp(vault, AgentSettingName.FEE)).gt(BN_ZERO) || toBN(this.getUpdateSettingValidAtTimestamp(vault, AgentSettingName.POOL_FEE_SHARE)).gt(BN_ZERO) ||
                toBN(this.getUpdateSettingValidAtTimestamp(vault, AgentSettingName.MINTING_VAULT_CR)).gt(BN_ZERO) || toBN(this.getUpdateSettingValidAtTimestamp(vault, AgentSettingName.MINTING_POOL_CR)).gt(BN_ZERO) ||
                toBN(this.getUpdateSettingValidAtTimestamp(vault, AgentSettingName.BUY_FASSET_FACTOR)).gt(BN_ZERO) || toBN(this.getUpdateSettingValidAtTimestamp(vault, AgentSettingName.POOL_EXIT_CR)).gt(BN_ZERO) ||
                toBN(this.getUpdateSettingValidAtTimestamp(vault, AgentSettingName.POOL_TOP_UP_CR)).gt(BN_ZERO) || toBN(this.getUpdateSettingValidAtTimestamp(vault, AgentSettingName.POOL_TOP_UP_TOKEN_PRICE_FACTOR)).gt(BN_ZERO)) {
                    updating = true;
                }
                const info = await this.getAgentVaultInfoFull(vault.vaultAddress, cli);
                const infoVault = await cli.context.assetManager.getAgentInfo(vault.vaultAddress);
                const mintedLots = Number(info.mintedUBA) / lotSize;
                const vaultCR = formatCR(info.vaultCollateralRatioBIPS);
                const poolCR = formatCR(info.poolCollateralRatioBIPS);
                const mintedAmount = Number(info.mintedUBA) / Number(settings.assetUnitUBA);
                let status = `Healthy`;
                switch (Number(info.status)) {
                    case AgentStatus.NORMAL: {
                        status = `Healthy`;
                        break;
                    }
                    case AgentStatus.CCB: {
                        status = `CCB`;
                        break;
                    }
                    case AgentStatus.LIQUIDATION: {
                        status = `Liquidating`;
                        break;
                    }
                    case AgentStatus.FULL_LIQUIDATION: {
                        status = `Liquidating`;
                        break;
                    }
                    case AgentStatus.DESTROYING: {
                        status = `Closing`;
                        break;
                    }
                }
                const collateral : any = collateralTypes.find(item => item.tokenFtsoSymbol === info.vaultCollateralToken);
                const collateralToken = await IERC20.at(collateral.token);

                //Calculate usd values
                const vaultCollateralType = await cli.context.assetManager.getCollateralType(CollateralClass.VAULT, infoVault.vaultCollateralToken)
                const priceVault = await priceReader.getPrice(vaultCollateralType.tokenFtsoSymbol, false, settings.maxTrustedPriceAgeSeconds);
                const priceVaultUSD = priceVault.price.mul(toBNExp(1, 18));
                const existingPrice = prices.find(p => p.symbol === vaultCollateralType.tokenFtsoSymbol);
                let totalVaultCollateralUSD = toBN(0);
                let totalPoolCollateralUSD = toBN(0);
                if (existingPrice) {
                    totalVaultCollateralUSD = toBN(info.totalVaultCollateralWei).mul(existingPrice.price).div(toBNExp(1, Number(vaultCollateralType.decimals) + existingPrice.decimals));
                    totalPoolCollateralUSD = toBN(info.totalPoolCollateralNATWei).mul(priceUSD).div(toBNExp(1, 18 + Number(cflrPrice.decimals)));
                } else {
                    const priceVault = await priceReader.getPrice(vaultCollateralType.tokenFtsoSymbol, false, settings.maxTrustedPriceAgeSeconds);
                    const priceVaultUSD = priceVault.price.mul(toBNExp(1, 18));
                    totalVaultCollateralUSD = toBN(info.totalVaultCollateralWei).mul(priceVaultUSD).div(toBNExp(1, Number(vaultCollateralType.decimals) + Number(priceVault.decimals)));
                    totalPoolCollateralUSD = toBN(info.totalPoolCollateralNATWei).mul(priceUSD).div(toBNExp(1, 18 + Number(cflrPrice.decimals)));
                    prices.push({ symbol: vaultCollateralType.tokenFtsoSymbol, price: priceVaultUSD, decimals: Number(priceVault.decimals) });
                }
                const totalCollateralUSD = formatFixed(totalVaultCollateralUSD.add(totalPoolCollateralUSD), 18, { decimals: 3, groupDigits: true, groupSeparator: "," });
                const feeShare = Number(info.poolFeeShareBIPS) / MAX_BIPS;
                const vaultInfo: VaultInfo = { address: vault.vaultAddress, updating: updating, status: info.publiclyAvailable, mintedlots: mintedLots.toString(),
                    freeLots: info.freeCollateralLots, vaultCR: vaultCR.toString(), poolCR: poolCR.toString(), mintedAmount: mintedAmount.toString(),
                    vaultAmount: formatFixed(toBN(info.totalVaultCollateralWei), Number(await collateralToken.decimals()), { decimals: 3, groupDigits: true, groupSeparator: "," }),
                    poolAmount: formatFixed(toBN(info.totalPoolCollateralNATWei), 18, { decimals: 3, groupDigits: true, groupSeparator: "," }),
                    agentCPTs: formatFixed(toBN(info.totalAgentPoolTokensWei), 18, { decimals: 3, groupDigits: true, groupSeparator: "," }),
                    collateralToken: info.vaultCollateralToken, health: status,
                    poolCollateralUSD: totalCollateralUSD,
                    mintCount: "0",
                    poolFee: (feeShare * 100).toString()
                };
                vaultsForFasset.push(vaultInfo);
            }
            if (vaultsForFasset.length != 0)
                allVaults.push({fassetSymbol: fasset, vaults: vaultsForFasset});
        }
        return allVaults;
    }

    async generateSecrets(): Promise<SecretsFile> {
        const secrets = generateSecrets(process.env.FASSET_BOT_CONFIG ?? resolveInFassetBotsCore("run-config/coston-bot.json"), ["agent"], "");
        return secrets;
    }

    async backedAmount(fAssetSymbol: string, agentVaultAddress: string): Promise<string> {
        const cli = await InfoBotCommands.create(this.secrets, FASSET_BOT_CONFIG, fAssetSymbol);
        const info = await cli.context.assetManager.getAgentInfo(agentVaultAddress);
        const fassetBR = await TokenBalances.fasset(cli.context);
        return fassetBR.formatValue(info.mintedUBA);
    }
}
