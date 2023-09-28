import { Controller, Get, Param, Post } from "@nestjs/common";
import { AgentService } from "../services/agent.service";
import { ApiTags } from "@nestjs/swagger";
import { ApiResponseWrapper, handleApiResponse } from "../../common/ApiResponse";
import { AgentBalance, AgentUnderlying } from "../../common/AgentResponse";

@ApiTags("Underlying")
@Controller("api/underlying")
export class UnderlyingController {
    constructor(private readonly agentService: AgentService) {}

    @Post("withdraw/announce/:fAssetSymbol/:agentVaultAddress")
    public async announceUnderlyingWithdrawal(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string
    ): Promise<ApiResponseWrapper<AgentUnderlying>> {
        return handleApiResponse(this.agentService.announceUnderlyingWithdrawal(fAssetSymbol, agentVaultAddress));
    }

    @Post("withdraw/perform/:fAssetSymbol/:agentVaultAddress/:amount/:destinationAddress/:paymentReference")
    public async performUnderlyingWithdrawal(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("amount") amount: string,
        @Param("destinationAddress") destinationAddress: string,
        @Param("paymentReference") paymentReference: string
    ): Promise<ApiResponseWrapper<AgentUnderlying>> {
        return handleApiResponse(this.agentService.performUnderlyingWithdrawal(fAssetSymbol, agentVaultAddress, amount, destinationAddress, paymentReference));
    }

    @Post("withdraw/confirm/:fAssetSymbol/:agentVaultAddress/:transactionHash")
    public async confirmUnderlyingWithdrawal(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("transactionHash") transactionHash: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.confirmUnderlyingWithdrawal(fAssetSymbol, agentVaultAddress, transactionHash));
    }

    @Post("withdraw/cancel/:fAssetSymbol/:agentVaultAddress")
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
    public async createUnderlying(@Param("fAssetSymbol") fAssetSymbol: string,): Promise<ApiResponseWrapper<AgentUnderlying>> {
        return handleApiResponse(this.agentService.createUnderlying(fAssetSymbol));
    }
}
