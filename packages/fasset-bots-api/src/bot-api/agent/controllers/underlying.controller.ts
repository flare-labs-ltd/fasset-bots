/* eslint-disable @typescript-eslint/no-unused-vars */
import { Controller, Get, HttpCode, Param, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AgentService } from "../services/agent.service";
import { ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ApiResponseWrapper, handleApiResponse } from "../../common/ApiResponse";
import { AgentBalance, AgentUnderlying } from "../../common/AgentResponse";
import { ErrorStatusInterceptor } from "../interceptors/error.status.interceptor";

@ApiTags("Underlying")
@Controller("api/underlying")
//@UseGuards(AuthGuard("api-key"))
@UseInterceptors(ErrorStatusInterceptor)
//@ApiSecurity("X-API-KEY")
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
