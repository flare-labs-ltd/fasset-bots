import { AgentBotCommands, AgentEntity } from "@flarelabs/fasset-bots-core";
import { AgentSettingsConfig, Secrets, loadConfigFile } from "@flarelabs/fasset-bots-core/config";
import { artifacts, createSha256Hash, generateRandomHexString, requireEnv, toBN, web3 } from "@flarelabs/fasset-bots-core/utils";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Inject, Injectable } from "@nestjs/common";
import { Cache } from "cache-manager";
import { PostAlert } from "../../../../../fasset-bots-core/src/utils/notifier/NotifierTransports";
import { APIKey, AgentBalance, AgentCreateResponse, AgentData, AgentSettings, AgentUnderlying, AgentVaultInfo, AgentVaultStatus, AllCollaterals, VaultCollaterals, requiredKeysForSecrets } from "../../common/AgentResponse";
import * as fs from 'fs';
import Web3 from "web3";
import { exec } from "child_process";

const IERC20 = artifacts.require("IERC20Metadata");

const FASSET_BOT_CONFIG: string = requireEnv("FASSET_BOT_CONFIG");
const FASSET_BOT_SECRETS: string = requireEnv("FASSET_BOT_SECRETS");


@Injectable()
export class AgentService {
    constructor(
        @Inject(CACHE_MANAGER) private cacheManager: Cache
    ) {}

    async createAgent(fAssetSymbol: string, agentSettings: AgentSettingsConfig): Promise<AgentCreateResponse | null> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
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
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.depositToVault(agentVaultAddress, amount);
    }

    async withdrawVaultCollateral(fAssetSymbol: string, agentVaultAddress: string, amount: string): Promise<void> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.announceWithdrawFromVault(agentVaultAddress, amount);
    }

    async closeVault(fAssetSymbol: string, agentVaultAddress: string): Promise<void> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.closeVault(agentVaultAddress);
    }

    async selfClose(fAssetSymbol: string, agentVaultAddress: string, amountUBA: string): Promise<void> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.selfClose(agentVaultAddress, amountUBA);
    }

    async buyPoolCollateral(fAssetSymbol: string, agentVaultAddress: string, amount: string): Promise<void> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.buyCollateralPoolTokens(agentVaultAddress, amount);
    }

    async withdrawPoolFees(fAssetSymbol: string, agentVaultAddress: string, amount: string): Promise<void> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.withdrawPoolFees(agentVaultAddress, amount);
    }

    async poolFeesBalance(fAssetSymbol: string, agentVaultAddress: string): Promise<AgentBalance> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        const balance = await cli.poolFeesBalance(agentVaultAddress);
        return { balance };
    }

    async freePoolCollateral(fAssetSymbol: string, agentVaultAddress: string): Promise<AgentBalance> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        const balance = await cli.getFreePoolCollateral(agentVaultAddress);
        return { balance };
    }

    async getFreeVaultCollateral(fAssetSymbol: string, agentVaultAddress: string): Promise<AgentBalance> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        const balance = await cli.getFreeVaultCollateral(agentVaultAddress);
        return { balance };
    }

    async delegatePoolCollateral(fAssetSymbol: string, agentVaultAddress: string, recipientAddress: string, bips: string): Promise<void> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.delegatePoolCollateral(agentVaultAddress, recipientAddress, bips);
    }

    async undelegatePoolCollateral(fAssetSymbol: string, agentVaultAddress: string): Promise<void> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.undelegatePoolCollateral(agentVaultAddress);
    }

    async enterAvailable(fAssetSymbol: string, agentVaultAddress: string): Promise<void> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.enterAvailableList(agentVaultAddress);
    }

    async announceExitAvailable(fAssetSymbol: string, agentVaultAddress: string): Promise<void> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.announceExitAvailableList(agentVaultAddress);
    }

    async exitAvailable(fAssetSymbol: string, agentVaultAddress: string): Promise<void> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.exitAvailableList(agentVaultAddress);
    }

    async announceUnderlyingWithdrawal(fAssetSymbol: string, agentVaultAddress: string): Promise<AgentUnderlying> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        const ref = await cli.announceUnderlyingWithdrawal(agentVaultAddress);
        return {
            paymentReference: ref,
        };
    }

    async performUnderlyingWithdrawal(
        fAssetSymbol: string,
        agentVaultAddress: string,
        amount: string,
        destinationAddress: string,
        paymentReference: string
    ): Promise<AgentUnderlying> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        const transactionHash = await cli.performUnderlyingWithdrawal(agentVaultAddress, amount, destinationAddress, paymentReference);
        return {
            transactionHash,
        };
    }

    async confirmUnderlyingWithdrawal(fAssetSymbol: string, agentVaultAddress: string, transactionHash: string): Promise<void> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.confirmUnderlyingWithdrawal(agentVaultAddress, transactionHash);
    }

    async cancelUnderlyingWithdrawal(fAssetSymbol: string, agentVaultAddress: string): Promise<void> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.cancelUnderlyingWithdrawal(agentVaultAddress);
    }

    async getFreeUnderlying(fAssetSymbol: string, agentVaultAddress: string): Promise<AgentBalance> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        const balance = await cli.getFreeUnderlying(agentVaultAddress);
        return {
            balance,
        };
    }

    async listAgentSetting(fAssetSymbol: string, agentVaultAddress: string): Promise<AgentSettings> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
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
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.updateAgentSetting(agentVaultAddress, settingName, settingValue);
    }

    async createUnderlying(fAssetSymbol: string): Promise<AgentUnderlying> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        const secrets = Secrets.load(FASSET_BOT_SECRETS);
        const account = await cli.createUnderlyingAccount(secrets);
        return { address: account.address, privateKey: account.privateKey };
    }

    async switchVaultCollateral(fAssetSymbol: string, agentVaultAddress: string, tokenAddress: string): Promise<void> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.switchVaultCollateral(agentVaultAddress, tokenAddress);
    }

    async upgradeWNat(fAssetSymbol: string, agentVaultAddress: string): Promise<void> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        await cli.upgradeWNatContract(agentVaultAddress);
    }

    async getAgentInfo(fAssetSymbol: string): Promise<AgentData> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        // get collateral data
        const collateralTypes = await cli.context.assetManager.getCollateralTypes();
        const collaterals = [];
        for (const collateralType of collateralTypes) {
            const symbol = collateralType.tokenFtsoSymbol;
            const token = await IERC20.at(collateralType.token);
            const balance = await token.balanceOf(cli.owner.workAddress);
            const collateral = { symbol, balance: balance.toString() } as any;
            if (symbol === "CFLR" || symbol === "C2FLR" || symbol === "SGB" || symbol == "FLR") {
                const nonWrappedBalance = await web3.eth.getBalance(cli.owner.workAddress);
                collateral.wrapped = collateral.balance;
                collateral.balance = nonWrappedBalance.toString();
            }
            collaterals.push(collateral);
        }
        // get is whitelisted
        const whitelisted = await cli.context.agentOwnerRegistry.isWhitelisted(cli.owner.managementAddress);
        return { collaterals, whitelisted };
    }

    async getAgentVaultsInfo(fAssetSymbol: string): Promise<AgentVaultStatus[]> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        // get agent infos
        const query = cli.orm.em.createQueryBuilder(AgentEntity);
        const agentVaults = await query.where({ active: true }).getResultList();
        const agentInfos: AgentVaultStatus[] = [];
        for (const agent of agentVaults) {
            const agentInfo = await cli.context.assetManager.getAgentInfo(agent.vaultAddress);
            agentInfos.push({
                vaultAddress: agent.vaultAddress,
                poolCollateralRatioBIPS: agentInfo.poolCollateralRatioBIPS.toString(),
                vaultCollateralRatioBIPS: agentInfo.vaultCollateralRatioBIPS.toString(),
                agentSettingUpdateValidAtFeeBIPS: agent.agentSettingUpdateValidAtFeeBIPS.toString(),
                agentSettingUpdateValidAtPoolFeeShareBIPS: agent.agentSettingUpdateValidAtPoolFeeShareBIPS.toString(),
                agentSettingUpdateValidAtMintingVaultCrBIPS: agent.agentSettingUpdateValidAtMintingVaultCrBIPS.toString(),
                agentSettingUpdateValidAtMintingPoolCrBIPS: agent.agentSettingUpdateValidAtMintingPoolCrBIPS.toString(),
                agentSettingUpdateValidAtBuyFAssetByAgentFactorBIPS: agent.agentSettingUpdateValidAtBuyFAssetByAgentFactorBIPS.toString(),
                agentSettingUpdateValidAtPoolExitCrBIPS: agent.agentSettingUpdateValidAtPoolExitCrBIPS.toString(),
                agentSettingUpdateValidAtPoolTopupCrBIPS: agent.agentSettingUpdateValidAtPoolTopupCrBIPS.toString(),
                agentSettingUpdateValidAtPoolTopupTokenPriceFactorBIPS: agent.agentSettingUpdateValidAtPoolTopupTokenPriceFactorBIPS.toString()
            })
        }
        return agentInfos
    }

    async getAgentVaultInfo(fAssetSymbol: string, agentVaultAddress: string): Promise<AgentVaultInfo> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        const info = await cli.context.assetManager.getAgentInfo(agentVaultAddress);
        const agentVaultInfo: any = {};
        for (const key of Object.keys(info)) {
            if (!isNaN(parseInt(key))) continue;
            const value = info[key as keyof typeof info];
            const modified = (typeof value === "boolean") ? value : value.toString();
            agentVaultInfo[key as keyof typeof info] = modified;
        }
        return agentVaultInfo;
    }

    async getAgentUnderlyingBalance(fAssetSymbol: string): Promise<AgentBalance> {
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fAssetSymbol);
        const balance = await cli.context.wallet.getBalance(cli.ownerUnderlyingAddress);
        return { balance: balance.toString() };
    }

    async saveNotification(notification: PostAlert): Promise<void> {
        let notifications: PostAlert[] | undefined = await this.cacheManager.get<PostAlert[]>("notifications");
        if (notifications == undefined) {
            notifications = [];
        }
        notifications.push(notification);

        let expirationTime: number | undefined = await this.cacheManager.get<number>("notifications_ttl");
        if (expirationTime == undefined || expirationTime < Date.now()) {
            expirationTime = Date.now() + 3600000;
            await this.cacheManager.set("notifications_ttl", expirationTime, 0);
            await this.cacheManager.set("notifications", notifications, 3600000);
        }
    }

    async getNotifications(): Promise<PostAlert[]> {
        const notifications: PostAlert[] = (await this.cacheManager.get<PostAlert[]>("notifications")) ?? [];
        return notifications;
    }

    async getAgentWorkAddress(): Promise<string> {
        const secrets = Secrets.load(FASSET_BOT_SECRETS);
        return secrets.required("owner.native.address");
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
        const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fassets[0]);
        const whitelisted = await cli.context.agentOwnerRegistry.isWhitelisted(cli.owner.managementAddress);
        return whitelisted;
    }

    async saveSecretsFile(secrets: string): Promise<void> {
        const missingKeys: string[] = [];
        // Validate json object to include necessary keys
        function checkNested(obj: any, ...levels: string[]): boolean {
            if (obj === undefined) return false;
            if (levels.length === 0) return true;
            const [level, ...rest] = levels;
            if (Object.prototype.hasOwnProperty.call(obj, level)) {
                return checkNested(obj[level], ...rest);
            }
            return false;
        }
        requiredKeysForSecrets.forEach((attr) => {
            const props = attr.split(".");
            if (!checkNested(secrets, ...props)) {
              missingKeys.push(attr);
            }
        });
        if (missingKeys.length > 0) {
            throw new Error(`Missing keys: ${missingKeys.join(', ')}`);
        }
        const jsonToSave = JSON.stringify(secrets, null, 4);
        fs.writeFileSync(FASSET_BOT_SECRETS, jsonToSave);
    }

    async checkSecretsFile(): Promise<boolean> {
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
        }
        return collaterals;
    }

    async generateWorkAddress(): Promise<any> {
        const web3 = new Web3();
        const account = web3.eth.accounts.create();
        return account;
    }

    async saveWorkAddress(address: string, privateKey: string): Promise<void> {
        const secrets = Secrets.load(FASSET_BOT_SECRETS);
        if(secrets.data.owner){
            secrets.data.owner.native.address = address;
            secrets.data.owner.native.private_key = privateKey;
            console.log(secrets);
            const json = JSON.stringify(secrets.data, null, 4);
            fs.writeFileSync(FASSET_BOT_SECRETS, json);
        }
        else {
            throw new Error(`Owner field does not exist in secrets.`);
        }
    }

    async checkBotStatus(): Promise<boolean> {
        return new Promise((resolve, reject) => {
            exec("ps -aux", (err, stdout, stderr) => {
                if (err) {
                    console.error(`Error executing command: ${err}`);
                    reject('Internal server error');
                }
                else{
                    resolve(stdout.toLowerCase().indexOf("yarn run-agent") > -1);
                }
            });
        });
    }

    async generateAPIKey(): Promise<APIKey> {
        const apiKey = generateRandomHexString(32);
        const hash = createSha256Hash(apiKey);
        return {key: apiKey, hash: hash};
    }

    async getVaultCollateralTokens(): Promise<VaultCollaterals[]> {
        const fassets = await this.getFassetSymbols();
        const collaterals: VaultCollaterals[] = [];
        for (const fasset of fassets) {
            const cli = await AgentBotCommands.create(FASSET_BOT_SECRETS, FASSET_BOT_CONFIG, fasset);
            // get collateral data
            const collateralTypes = await cli.context.assetManager.getCollateralTypes();
            const collateralTokens: string[] = [];
            for (const collateralType of collateralTypes) {
                const symbol = collateralType.tokenFtsoSymbol;
                const collateralClass = collateralType.collateralClass;
                if (collateralClass == toBN(2)) {
                    collateralTokens.push(symbol);
                }
            }
            const collateral: VaultCollaterals = { fassetSymbol: fasset, collaterals: collateralTokens };
            collaterals.push(collateral);
        }
        return collaterals;
    }
}
