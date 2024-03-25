import { Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AgentService } from "../services/agent.service";
import { ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ApiResponseWrapper, handleApiResponse } from "../../common/ApiResponse";
import { AgentBalance } from "../../common/AgentResponse";

@ApiTags("Pool Collateral")
@Controller("api/pool")
@UseGuards(AuthGuard("api-key"))
@ApiSecurity("X-API-KEY")
export class PoolController {
    constructor(private readonly agentService: AgentService) {}

    @Post("collateral/buy/:fAssetSymbol/:agentVaultAddress/:amount")
    @HttpCode(200)
    public async buyPoolCollateral(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("amount") amount: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.buyPoolCollateral(fAssetSymbol, agentVaultAddress, amount));
    }

    @Get("collateral/freeBalance:fAssetSymbol/:agentVaultAddress")
    public async freePoolCollateral(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string
    ): Promise<ApiResponseWrapper<AgentBalance>> {
        return handleApiResponse(this.agentService.freePoolCollateral(fAssetSymbol, agentVaultAddress));
    }

    @Post("fee/withdraw/:fAssetSymbol/:agentVaultAddress/:amount")
    @HttpCode(200)
    public async withdrawPoolFees(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("amount") amount: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.withdrawPoolFees(fAssetSymbol, agentVaultAddress, amount));
    }

    @Get("fee/balance/:fAssetSymbol/:agentVaultAddress")
    public async poolFeesBalance(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string
    ): Promise<ApiResponseWrapper<AgentBalance>> {
        return handleApiResponse(this.agentService.poolFeesBalance(fAssetSymbol, agentVaultAddress));
    }

    @Post("delegate/:fAssetSymbol/:agentVaultAddress/:recipientAddress/:bips")
    public async delegatePoolCollateral(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("recipientAddress") recipientAddress: string,
        @Param("bips") bips: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.delegatePoolCollateral(fAssetSymbol, agentVaultAddress, recipientAddress, bips));
    }

    @Post("undelegate/:fAssetSymbol/:agentVaultAddress")
    public async undelegatePoolCollateral(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.undelegatePoolCollateral(fAssetSymbol, agentVaultAddress));
    }

    @Post("upgradeWNat/:fAssetSymbol/:agentVaultAddress")
    public async upgradeWNatContract(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.upgradeWNat(fAssetSymbol, agentVaultAddress));
    }
}
