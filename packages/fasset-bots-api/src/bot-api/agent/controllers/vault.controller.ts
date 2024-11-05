/* eslint-disable @typescript-eslint/no-unused-vars */
import { Controller, Get, HttpCode, Param, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { AgentService } from "../services/agent.service";
import { ApiBearerAuth, ApiOkResponse, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ApiResponseWrapper, handleApiResponse } from "../../common/ApiResponse";
import { AgentBalance } from "../../common/AgentResponse";
import { ErrorStatusInterceptor } from "../interceptors/error.status.interceptor";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";


@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiTags("Agent Vault")
@Controller("api/agentVault")
@UseInterceptors(ErrorStatusInterceptor)
@UseGuards(JwtAuthGuard)
export class AgentVaultController {
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
    @Post("collateral/deposit/:fAssetSymbol/:agentVaultAddress/:amount")
    @HttpCode(200)
    public async depositVaultCollateral(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("amount") amount: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.depositToVault(fAssetSymbol, agentVaultAddress, amount));
    }

    @Post("collateral/withdrawVault/:fAssetSymbol/:agentVaultAddress/:amount")
    @HttpCode(200)
    public async withdrawVaultCollateral(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("amount") amount: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.withdrawVaultCollateral(fAssetSymbol, agentVaultAddress, amount));
    }

    @Get("collateral/freeVaultBalance/:fAssetSymbol/:agentVaultAddress")
    public async getFreeVaultCollateral(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string
    ): Promise<ApiResponseWrapper<AgentBalance>> {
        return handleApiResponse(this.agentService.getFreeVaultCollateral(fAssetSymbol, agentVaultAddress));
    }

    @Post("collateral/switch/:fAssetSymbol/:agentVaultAddress/:tokenAddress")
    public async switchVaultCollateral(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("tokenAddress") tokenAddress: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.switchVaultCollateral(fAssetSymbol, agentVaultAddress, tokenAddress));
    }

    @Post("close/:fAssetSymbol/:agentVaultAddress")
    @HttpCode(200)
    public async closeVault(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.closeVault(fAssetSymbol, agentVaultAddress));
    }


    @Get("backedAmount/:fAssetSymbol/:agentVaultAddress")
    @ApiOkResponse({
        description: 'Example of successful response.',
        schema: {
            type: 'object',
            properties: {
                status: { type: 'string', example: 'OK' },
                data: { type: 'string', example: '12.5' }
            }
        }
    })
    public async getBackedAmount(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
    ): Promise<ApiResponseWrapper<string>> {
        return handleApiResponse(this.agentService.backedAmount(fAssetSymbol, agentVaultAddress));
    }
}
