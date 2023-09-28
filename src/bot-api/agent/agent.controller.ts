import { Controller, Get, Param, Post } from "@nestjs/common";
import { AgentService } from "./agent.service";
import { ApiTags } from "@nestjs/swagger";
import { ApiResponseWrapper, handleApiResponse } from "../common/ApiResponse";
import { AgentBalance, AgentCreateResponse } from "../common/AgentResponse";

@ApiTags("Agent")
@Controller("api/agent")
export class AgentController {
    constructor(private readonly agentService: AgentService) {}

    @Get("create/:fAssetSymbol")
    public async create(@Param("fAssetSymbol") fAssetSymbol: string): Promise<ApiResponseWrapper<AgentCreateResponse | null>> {
        return handleApiResponse(this.agentService.createAgent(fAssetSymbol));
    }

    @Post("agentVault/collateral/deposit/:fAssetSymbol/:agentVaultAddress/:amount")
    public async depositVaultCollateral(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("amount") amount: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.depositToVault(fAssetSymbol, agentVaultAddress, amount));
    }

    @Post("agentVault/collateral/withdraw/:fAssetSymbol/:agentVaultAddress/:amount")
    public async withdrawVaultCollateral(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("amount") amount: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.withdrawVaultCollateral(fAssetSymbol, agentVaultAddress, amount));
    }

    @Post("pool/collateral/buy:fAssetSymbol/:agentVaultAddress/:amount")
    public async buyPoolCollateral(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("amount") amount: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.buyPoolCollateral(fAssetSymbol, agentVaultAddress, amount));
    }

    @Get("pool/collateral/freeBalance:fAssetSymbol/:agentVaultAddress")
    public async freePoolCollateral(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
    ): Promise<ApiResponseWrapper<AgentBalance>> {
        return handleApiResponse(this.agentService.freePoolCollateral(fAssetSymbol, agentVaultAddress));
    }

    @Post("pool/fee/withdraw/:fAssetSymbol/:agentVaultAddress/:amount")
    public async withdrawPoolFees(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("amount") amount: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.withdrawPoolFees(fAssetSymbol, agentVaultAddress, amount));
    }

    @Get("pool/fee/balance/:fAssetSymbol/:agentVaultAddress")
    public async poolFeesBalance(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
    ): Promise<ApiResponseWrapper<AgentBalance>> {
        return handleApiResponse(this.agentService.poolFeesBalance(fAssetSymbol, agentVaultAddress));
    }

    @Get("pool/delegate/:fAssetSymbol/:agentVaultAddress/:recipientAddress/:bips")
    public async delegatePoolCollateral(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("recipientAddress") recipientAddress: string,
        @Param("bips") bips: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.delegatePoolCollateral(fAssetSymbol, agentVaultAddress, recipientAddress, bips));
    }

    @Get("pool/undelegate/:fAssetSymbol/:agentVaultAddress")
    public async undelegatePoolCollateral(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.undelegatePoolCollateral(fAssetSymbol, agentVaultAddress));
    }

    @Post("available/enter/:fAssetSymbol/:agentVaultAddress")
    public async enter(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.enterAvailable(fAssetSymbol, agentVaultAddress));
    }

    @Post("available/announceExit/:fAssetSymbol/:agentVaultAddress")
    public async announceExit(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.announceExitAvailable(fAssetSymbol, agentVaultAddress));
    }

    @Post("available/exit/:fAssetSymbol/:agentVaultAddress")
    public async exit(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.exitAvailable(fAssetSymbol, agentVaultAddress));
    }
}
