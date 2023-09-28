import { Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { AgentService } from "../services/agent.service";
import { ApiTags } from "@nestjs/swagger";
import { ApiResponseWrapper, handleApiResponse } from "../../common/ApiResponse";
import { AgentCreateResponse } from "../../common/AgentResponse";

@ApiTags("Agent")
@Controller("api/agent")
export class AgentController {
    constructor(private readonly agentService: AgentService) {}

    @Get("create/:fAssetSymbol")
    public async create(@Param("fAssetSymbol") fAssetSymbol: string): Promise<ApiResponseWrapper<AgentCreateResponse | null>> {
        return handleApiResponse(this.agentService.createAgent(fAssetSymbol));
    }

    @Post("available/enter/:fAssetSymbol/:agentVaultAddress")
    @HttpCode(200)
    public async enter(@Param("fAssetSymbol") fAssetSymbol: string, @Param("agentVaultAddress") agentVaultAddress: string): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.enterAvailable(fAssetSymbol, agentVaultAddress));
    }

    @Post("available/announceExit/:fAssetSymbol/:agentVaultAddress")
    @HttpCode(200)
    public async announceExit(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.announceExitAvailable(fAssetSymbol, agentVaultAddress));
    }

    @Post("available/exit/:fAssetSymbol/:agentVaultAddress")
    @HttpCode(200)
    public async exit(@Param("fAssetSymbol") fAssetSymbol: string, @Param("agentVaultAddress") agentVaultAddress: string): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.exitAvailable(fAssetSymbol, agentVaultAddress));
    }

    @Post("selfClose/:fAssetSymbol/:agentVaultAddress/:amountUBA")
    @HttpCode(200)
    public async selfClose(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("amountUBA") amountUBA: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.selfClose(fAssetSymbol, agentVaultAddress, amountUBA));
    }

    @Post("settings/update/:fAssetSymbol/:agentVaultAddress/:settingName/:settingValue")
    @HttpCode(200)
    public async updateAgentSetting(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("settingName") settingName: string,
        @Param("settingValue") settingValue: string,
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.updateAgentSetting(fAssetSymbol, agentVaultAddress, settingName, settingValue));
    }
}
