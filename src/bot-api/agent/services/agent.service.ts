import { Injectable } from "@nestjs/common";
import { BotCliCommands } from "../../../actors/AgentBotCliCommands";
import { AgentCreateResponse, AgentBalance, AgentUnderlying, AgentSettings } from "../../common/AgentResponse";
import { artifacts } from "../../../utils/web3";

const IERC20 = artifacts.require("IERC20Metadata");

@Injectable()
export class AgentService {
    async createAgent(fAssetSymbol: string, poolTokenSuffix: string): Promise<AgentCreateResponse | null> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        const agent = await cli.createAgentVault(poolTokenSuffix);
        if (agent) {
            return {
                vaultAddress: agent.vaultAddress,
                ownerAddress: agent.ownerAddress,
                collateralPoolAddress: agent.collateralPool.address,
                collateralPoolTokenAddress: agent.collateralPoolToken.address,
                underlyingAddress: agent.underlyingAddress,
            };
        }
        return null;
    }

    async depositToVault(fAssetSymbol: string, agentVaultAddress: string, amount: string): Promise<void> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        await cli.depositToVault(agentVaultAddress, amount);
    }

    async withdrawVaultCollateral(fAssetSymbol: string, agentVaultAddress: string, amount: string): Promise<void> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        await cli.announceWithdrawFromVault(agentVaultAddress, amount);
    }

    async closeVault(fAssetSymbol: string, agentVaultAddress: string): Promise<void> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        await cli.closeVault(agentVaultAddress);
    }

    async selfClose(fAssetSymbol: string, agentVaultAddress: string, amountUBA: string): Promise<void> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        await cli.selfClose(agentVaultAddress, amountUBA);
    }

    async buyPoolCollateral(fAssetSymbol: string, agentVaultAddress: string, amount: string): Promise<void> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        await cli.buyCollateralPoolTokens(agentVaultAddress, amount);
    }

    async withdrawPoolFees(fAssetSymbol: string, agentVaultAddress: string, amount: string): Promise<void> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        await cli.withdrawPoolFees(agentVaultAddress, amount);
    }

    async poolFeesBalance(fAssetSymbol: string, agentVaultAddress: string): Promise<AgentBalance> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        const balance = await cli.poolFeesBalance(agentVaultAddress);
        return { balance };
    }

    async freePoolCollateral(fAssetSymbol: string, agentVaultAddress: string): Promise<AgentBalance> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        const balance = await cli.getFreePoolCollateral(agentVaultAddress);
        return { balance };
    }

    async getFreeVaultCollateral(fAssetSymbol: string, agentVaultAddress: string): Promise<AgentBalance> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        const balance = await cli.getFreeVaultCollateral(agentVaultAddress);
        return { balance };
    }

    async delegatePoolCollateral(fAssetSymbol: string, agentVaultAddress: string, recipientAddress: string, bips: string): Promise<void> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        await cli.delegatePoolCollateral(agentVaultAddress, recipientAddress, bips);
    }

    async undelegatePoolCollateral(fAssetSymbol: string, agentVaultAddress: string): Promise<void> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        await cli.undelegatePoolCollateral(agentVaultAddress);
    }

    async enterAvailable(fAssetSymbol: string, agentVaultAddress: string): Promise<void> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        await cli.enterAvailableList(agentVaultAddress);
    }

    async announceExitAvailable(fAssetSymbol: string, agentVaultAddress: string): Promise<void> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        await cli.announceExitAvailableList(agentVaultAddress);
    }

    async exitAvailable(fAssetSymbol: string, agentVaultAddress: string): Promise<void> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        await cli.exitAvailableList(agentVaultAddress);
    }

    async announceUnderlyingWithdrawal(fAssetSymbol: string, agentVaultAddress: string): Promise<AgentUnderlying> {
        const cli = await BotCliCommands.create(fAssetSymbol);
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
        const cli = await BotCliCommands.create(fAssetSymbol);
        const transactionHash = await cli.performUnderlyingWithdrawal(agentVaultAddress, amount, destinationAddress, paymentReference);
        return {
            transactionHash,
        };
    }

    async confirmUnderlyingWithdrawal(fAssetSymbol: string, agentVaultAddress: string, transactionHash: string): Promise<void> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        await cli.confirmUnderlyingWithdrawal(agentVaultAddress, transactionHash);
    }

    async cancelUnderlyingWithdrawal(fAssetSymbol: string, agentVaultAddress: string): Promise<void> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        await cli.cancelUnderlyingWithdrawal(agentVaultAddress);
    }

    async getFreeUnderlying(fAssetSymbol: string, agentVaultAddress: string): Promise<AgentBalance> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        const balance = await cli.getFreeUnderlying(agentVaultAddress);
        return {
            balance,
        };
    }

    async listAgentSetting(fAssetSymbol: string, agentVaultAddress: string): Promise<AgentSettings> {
        const cli = await BotCliCommands.create(fAssetSymbol);
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
        const cli = await BotCliCommands.create(fAssetSymbol);
        await cli.updateAgentSetting(agentVaultAddress, settingName, settingValue);
    }

    async createUnderlying(fAssetSymbol: string): Promise<AgentUnderlying> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        const account = await cli.createUnderlyingAccount();
        return { address: account.address, privateKey: account.privateKey };
    }

    async switchVaultCollateral(fAssetSymbol: string, agentVaultAddress: string, tokenAddress: string): Promise<void> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        await cli.switchVaultCollateral(agentVaultAddress, tokenAddress);
    }

    async upgradeWNat(fAssetSymbol: string, agentVaultAddress: string): Promise<void> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        await cli.upgradeWNatContract(agentVaultAddress);
    }
}
