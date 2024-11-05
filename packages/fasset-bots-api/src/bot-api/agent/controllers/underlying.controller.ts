/* eslint-disable @typescript-eslint/no-unused-vars */
import { Controller, Get, HttpCode, Param, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { AgentService } from "../services/agent.service";
import { ApiBearerAuth, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ApiResponseWrapper, handleApiResponse } from "../../common/ApiResponse";
import { AgentBalance, AgentUnderlying } from "../../common/AgentResponse";
import { ErrorStatusInterceptor } from "../interceptors/error.status.interceptor";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";


@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiTags("Underlying")
@Controller("api/underlying")
@UseInterceptors(ErrorStatusInterceptor)
@UseGuards(JwtAuthGuard)
export class UnderlyingController {
    constructor(private readonly agentService: AgentService) {}

    @Get("withdraw/:fAssetSymbol/:agentVaultAddress/:amount/:destinationAddress")
    @HttpCode(200)
    public async withdrawUnderlying(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("amount") amount: string,
        @Param("destinationAddress") destinationAddress: string,
    ): Promise<ApiResponseWrapper<AgentUnderlying>> {
        return handleApiResponse(this.agentService.withdrawUnderlying(fAssetSymbol, agentVaultAddress, amount, destinationAddress));
    }

    @Post("withdraw/cancel/:fAssetSymbol/:agentVaultAddress")
    @HttpCode(200)
    public async cancelUnderlyingWithdrawal(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.cancelUnderlyingWithdrawal(fAssetSymbol, agentVaultAddress));
    }

    @Get("freeBalance/:fAssetSymbol/:agentVaultAddress")
    public async getFreeUnderlying(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string
    ): Promise<ApiResponseWrapper<AgentBalance>> {
        return handleApiResponse(this.agentService.getFreeUnderlying(fAssetSymbol, agentVaultAddress));
    }

    @Get("create/:fAssetSymbol")
    public async createUnderlying(@Param("fAssetSymbol") fAssetSymbol: string): Promise<ApiResponseWrapper<AgentUnderlying>> {
        return handleApiResponse(this.agentService.createUnderlying(fAssetSymbol));
    }
}
