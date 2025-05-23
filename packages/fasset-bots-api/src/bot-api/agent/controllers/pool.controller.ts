/* eslint-disable @typescript-eslint/no-unused-vars */
import { Body, Controller, Get, HttpCode, Param, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { AgentService } from "../services/agent.service";
import { ApiBearerAuth, ApiOkResponse, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ApiResponseWrapper, handleApiResponse } from "../../common/ApiResponse";
import { AgentBalance } from "../../common/AgentResponse";
import { ErrorStatusInterceptor } from "../interceptors/error.status.interceptor";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { DelegateDTO } from "../../common/AgentSettingsDTO";


@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiTags("Pool Collateral")
@Controller("api/pool")
@UseInterceptors(ErrorStatusInterceptor)
@UseGuards(JwtAuthGuard)
export class PoolController {
    constructor(private readonly agentService: AgentService) {}

    @ApiOkResponse({
        description: 'Example of successful response.',
        schema: {
            type: 'object',
            properties: {
                status: { type: 'string', example: 'OK' }
            }
        }
    })
    @Post("collateral/buy/:fAssetSymbol/:agentVaultAddress/:amount")
    @HttpCode(200)
    public async buyPoolCollateral(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("amount") amount: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.buyPoolCollateral(fAssetSymbol, agentVaultAddress, amount));
    }

    @Get("collateral/freePoolBalance/:fAssetSymbol/:agentVaultAddress")
    public async freePoolCollateral(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string
    ): Promise<ApiResponseWrapper<AgentBalance>> {
        return handleApiResponse(this.agentService.freePoolCollateral(fAssetSymbol, agentVaultAddress));
    }

    @Get("collateral/poolBalance/:fAssetSymbol/:agentVaultAddress")
    public async poolTokenBalance(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string
    ): Promise<ApiResponseWrapper<AgentBalance>> {
        return handleApiResponse(this.agentService.poolTokenBalance(fAssetSymbol, agentVaultAddress));
    }

    @Post("collateral/withdrawPool/:fAssetSymbol/:agentVaultAddress/:amount")
    @HttpCode(200)
    public async withdrawPoolCollateral(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("amount") amount: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.withdrawPoolCollateral(fAssetSymbol, agentVaultAddress, amount));
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

    @Post("delegateAll/:fAssetSymbol/:agentVaultAddress")
    public async delegatePoolCollateralArray(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Body() delegationsDTO: DelegateDTO[]
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.delegatePoolCollateralArray(fAssetSymbol, agentVaultAddress, delegationsDTO));
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
