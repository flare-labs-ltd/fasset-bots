import { Injectable } from "@nestjs/common";
import { BotCliCommands } from "../../actors/AgentBotCliCommands";
import { AgentCreateResponse, AgentPoolFeeBalance } from "../common/AgentResponse";

@Injectable()
export class AgentService {
    async createAgent(fAssetSymbol: string): Promise<AgentCreateResponse | null> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        const agent = await cli.createAgentVault();
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
        await cli.withdrawFromVault(agentVaultAddress, amount);
    }

    async buyPoolCollateral(fAssetSymbol: string, agentVaultAddress: string, amount: string): Promise<void> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        await cli.buyCollateralPoolTokens(agentVaultAddress, amount);
    }

    async withdrawPoolFees(fAssetSymbol: string, agentVaultAddress: string, amount: string): Promise<void> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        await cli.withdrawPoolFees(agentVaultAddress, amount);
    }

    async poolFeesBalance(fAssetSymbol: string, agentVaultAddress: string): Promise<AgentPoolFeeBalance> {
        const cli = await BotCliCommands.create(fAssetSymbol);
        const balance = await cli.poolFeesBalance(agentVaultAddress);
        return { balance: balance.toString() };
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
}
