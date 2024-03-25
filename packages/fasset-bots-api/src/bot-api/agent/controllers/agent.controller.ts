import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AgentService } from "../services/agent.service";
import { ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ApiResponseWrapper, handleApiResponse } from "../../common/ApiResponse";
import { AgentBalance, AgentCreateResponse, AgentData, AgentSettings, AgentVaultInfo, AgentVaultStatus } from "../../common/AgentResponse";
import { AgentSettingsConfig } from "@flarelabs/fasset-bots-core/config";
import { PostAlert } from "../../../../../fasset-bots-core/src/utils/notifier/NotifierTransports";
import { AgentSettingsService } from "../services/agentSettings.service";
import { AgentSettingsConfigDTO } from "../../common/AgentettingsConfigDTO";

@ApiTags("Agent")
@Controller("api/agent")
@UseGuards(AuthGuard("api-key"))
@ApiSecurity("X-API-KEY")
export class AgentController {
    constructor(
        private readonly agentService: AgentService,
        private agentSettingsService: AgentSettingsService
    ) {}

    @Post("create/:fAssetSymbol")
    public async create(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Body() agentSettings: AgentSettingsConfigDTO
    ): Promise<ApiResponseWrapper<AgentCreateResponse | null>> {
        const settings: AgentSettingsConfig = this.agentSettingsService.mapDtoToInterface(agentSettings);
        return handleApiResponse(this.agentService.createAgent(fAssetSymbol, settings));
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

    @Get("settings/list/:fAssetSymbol/:agentVaultAddress")
    @HttpCode(200)
    public async getAgentSetting(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string
    ): Promise<ApiResponseWrapper<AgentSettings>> {
        return handleApiResponse(this.agentService.listAgentSetting(fAssetSymbol, agentVaultAddress));
    }

    @Post("settings/update/:fAssetSymbol/:agentVaultAddress/:settingName/:settingValue")
    @HttpCode(200)
    public async updateAgentSetting(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("settingName") settingName: string,
        @Param("settingValue") settingValue: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.updateAgentSetting(fAssetSymbol, agentVaultAddress, settingName, settingValue));
    }

    @Get("info/data/:fAssetSymbol")
    @HttpCode(200)
    public async getAgentData(
        @Param("fAssetSymbol") fAssetSymbol: string
    ): Promise<ApiResponseWrapper<AgentData>> {
        return handleApiResponse(this.agentService.getAgentInfo(fAssetSymbol));
    }

    @Get("info/vaults/:fAssetSymbol")
    @HttpCode(200)
    public async getAgentStatus(
        @Param("fAssetSymbol") fAssetSymbol: string
    ): Promise<ApiResponseWrapper<AgentVaultStatus[]>> {
        return handleApiResponse(this.agentService.getAgentVaultsInfo(fAssetSymbol));
    }

    @Get("info/vault/:fAssetSymbol/:agentVaultAddress")
    @HttpCode(200)
    public async getAgentVaultInfo(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string
    ): Promise<ApiResponseWrapper<AgentVaultInfo>> {
        return handleApiResponse(this.agentService.getAgentVaultInfo(fAssetSymbol, agentVaultAddress));
    }

    @Get("info/underlying/balance/:fAssetSymbol")
    @HttpCode(200)
    public async getAgentUnderlyingBalance(
        @Param("fAssetSymbol") fAssetSymbol: string
    ): Promise<ApiResponseWrapper<AgentBalance>> {
        return handleApiResponse(this.agentService.getAgentUnderlyingBalance(fAssetSymbol));
    }

    @Post("botAlert")
    @HttpCode(200)
    public async sendNotification(
        @Body() notification: PostAlert
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.saveNotification(notification));
    }

    @Get("botAlert")
    @HttpCode(200)
    public async getNotifications(
    ): Promise<ApiResponseWrapper<PostAlert[]>> {
        return handleApiResponse(this.agentService.getNotifications());
    }

    @Get("workAddress")
    @HttpCode(200)
    public async getAgentWorkAddress(
    ): Promise<ApiResponseWrapper<string>> {
        return handleApiResponse(this.agentService.getAgentWorkAddress());
    }
}
