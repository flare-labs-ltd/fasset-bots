import { AgentBotCommands } from "@flarelabs/fasset-bots-core";
import { AgentSettingsConfig } from "@flarelabs/fasset-bots-core/config";
import { artifacts, requireEnv } from "@flarelabs/fasset-bots-core/utils";
import { Injectable } from "@nestjs/common";
import { AgentBalance, AgentCreateResponse, AgentSettings, AgentUnderlying } from "../../common/AgentResponse";
import { Inject, Injectable } from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { BotCliCommands, AgentEntity } from "@flarelabs/fasset-bots-core";
import { AgentSettingsConfig, decodedChainId, requireSecret } from "@flarelabs/fasset-bots-core/config";
import { artifacts, requireEnv, web3 } from "@flarelabs/fasset-bots-core/utils";
import { AgentBalance, AgentCreateResponse, AgentData, AgentSettings, AgentUnderlying, AgentVaultInfo, AgentVaultStatus } from "../../common/AgentResponse";
import { PostAlert } from "../../../../../fasset-bots-core/src/utils/notifier/NotifierTransports";
import { Cache } from "cache-manager";

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
        const account = await cli.createUnderlyingAccount();
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

    async getAgentInfo(fAssetSymbol: string): Promise<AgentData>  {
        const cli = await BotCliCommands.create(FASSET_BOT_CONFIG, fAssetSymbol);
        // get collateral data
        const collateralTypes = await cli.context.assetManager.getCollateralTypes();
        const collaterals = [];
        for (const collateralType of collateralTypes) {
            const token = await IERC20.at(collateralType.token);
            const balance = await token.balanceOf(cli.owner.workAddress);
            collaterals.push({ symbol: collateralType.tokenFtsoSymbol, balance: balance.toString() });
        }
        const natBalance = await web3.eth.getBalance(cli.owner.workAddress);
        collaterals.push({ symbol: "NAT (non-wrapped)", balance: natBalance.toString() });
        // get is whitelisted
        const whitelisted = await cli.context.agentOwnerRegistry.isWhitelisted(cli.owner.managementAddress);
        return { collaterals, whitelisted };
    }

    async getAgentVaultsInfo(fAssetSymbol: string): Promise<AgentVaultStatus[]> {
        const cli = await BotCliCommands.create(FASSET_BOT_CONFIG, fAssetSymbol);
        // get agent infos
        const query = cli.botConfig.orm!.em.createQueryBuilder(AgentEntity);
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
        const cli = await BotCliCommands.create(FASSET_BOT_CONFIG, fAssetSymbol);
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
        const cli = await BotCliCommands.create(FASSET_BOT_CONFIG, fAssetSymbol);
        const ownerUnderlyingAddress = requireSecret(`owner.${decodedChainId(cli.context.chainInfo.chainId)}.address`);
        const balance = await cli.context.wallet.getBalance(ownerUnderlyingAddress);
        return { balance: balance.toString() };
    }

    async saveNotification(notification: PostAlert): Promise<void> {
        let notifications: PostAlert[] | undefined  = await this.cacheManager.get<PostAlert[]>("notifications");
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
        const notifications: PostAlert[]  = (await this.cacheManager.get<PostAlert[]>("notifications")) ?? [];
        return notifications;
    }

    async getAgentWorkAddress(): Promise<string> {
        return requireSecret("owner.native.address", undefined, true);
    }
}
