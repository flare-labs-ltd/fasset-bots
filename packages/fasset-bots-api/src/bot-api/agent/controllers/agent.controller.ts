/* eslint-disable @typescript-eslint/no-unused-vars */
import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { AgentService } from "../services/agent.service";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ApiResponseWrapper, handleApiResponse } from "../../common/ApiResponse";
import { APIKey, AgentBalance, AgentCreateResponse, AgentData, AgentSettings, AgentVaultStatus, AllBalances, AllCollaterals, ExtendedAgentVaultInfo, UnderlyingAddress, VaultCollaterals } from "../../common/AgentResponse";
import { AgentSettingsConfig } from "@flarelabs/fasset-bots-core/config";
import { PostAlert } from "../../../../../fasset-bots-core/src/utils/notifier/NotifierTransports";
import { AgentSettingsService } from "../services/agentSettings.service";
import { AgentSettingsConfigDTO } from "../../common/AgentSettingsConfigDTO";
import { ErrorStatusInterceptor } from "../interceptors/error.status.interceptor";
import { AgentSettingsDTO } from "../../common/AgentSettingsDTO";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthGuard } from "@nestjs/passport";

@ApiTags("Agent")
@Controller("api/agent")
@UseInterceptors(ErrorStatusInterceptor)
export class AgentController {
    constructor(
        private readonly agentService: AgentService,
        private agentSettingsService: AgentSettingsService
    ) {}

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Post("create/:fAssetSymbol")
    @ApiOkResponse({
        description: 'Example of successful response.',
        schema: {
            type: 'object',
            properties: {
                status: { type: 'string', example: 'OK' },
                data: {
                    type: 'object',
                    properties: {
                        vaultAddress: { type: 'string', example: '0xA816A2d4f683836bEB6E89152BD24D2B61aEB78F' },
                        ownerAddress: { type: 'string', example: '0x19E2b0f41c09250Bf2A024187593d9B6DCA48da8' },
                        collateralPoolAddress: { type: 'string', example: '0xAf9528F2d9A4dcC5e87FfD580AA238f66Fa6D56D' },
                        collateralPoolTokenAddress: { type: 'string', example: '0x68B352C1b892a4A027758A167ea5b8148AdCeEfc' },
                        underlyingAddress: { type: 'string', example: 'rNHQbcDTCyUGcS21bZSbuSyjEgNP98hBic' }
                    }
                }
            }
        }
    })
    public async create(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Body() agentSettings: AgentSettingsConfigDTO
    ): Promise<ApiResponseWrapper<AgentCreateResponse | null>> {
        const settings: AgentSettingsConfig = this.agentSettingsService.mapDtoToInterface(agentSettings);
        return handleApiResponse(this.agentService.createAgent(fAssetSymbol, settings));
    }

    @ApiOkResponse({
        description: 'Example of successful response.',
        schema: {
            type: 'object',
            properties: {
                status: { type: 'string', example: 'OK' }
            }
        }
    })
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Post("available/enter/:fAssetSymbol/:agentVaultAddress")
    public async enter(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.enterAvailable(fAssetSymbol, agentVaultAddress));
    }

    @ApiOkResponse({
        description: 'Example of successful response.',
        schema: {
            type: 'object',
            properties: {
                status: { type: 'string', example: 'OK' }
            }
        }
    })
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Post("available/exit/:fAssetSymbol/:agentVaultAddress")
    public async exit(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.announceExitAvailable(fAssetSymbol, agentVaultAddress));
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Post("selfClose/:fAssetSymbol/:agentVaultAddress/:amountUBA")
    public async selfClose(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("amountUBA") amountUBA: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.selfClose(fAssetSymbol, agentVaultAddress, amountUBA));
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Get("settings/list/:fAssetSymbol/:agentVaultAddress")
    public async getAgentSetting(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string
    ): Promise<ApiResponseWrapper<AgentSettings>> {
        return handleApiResponse(this.agentService.listAgentSetting(fAssetSymbol, agentVaultAddress));
    }

    @ApiOkResponse({
        description: 'Example of successful response.',
        schema: {
            type: 'object',
            properties: {
                status: { type: 'string', example: 'OK' }
            }
        }
    })
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Post("settings/update/:fAssetSymbol/:agentVaultAddress/:settingName/:settingValue")
    public async updateAgentSetting(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("settingName") settingName: string,
        @Param("settingValue") settingValue: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.updateAgentSetting(fAssetSymbol, agentVaultAddress, settingName, settingValue));
    }

    @ApiOkResponse({
        description: 'Example of successful response.',
        schema: {
            type: 'object',
            properties: {
                status: { type: 'string', example: 'OK' }
            }
        }
    })
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Post("settings/update/:fAssetSymbol/:agentVaultAddress")
    public async updateAgentSettings(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Body() settingsDTO: AgentSettingsDTO[]
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.updateAgentSettings(fAssetSymbol, agentVaultAddress, settingsDTO));
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Get("info/data/:fAssetSymbol")
    @ApiOperation({ summary: 'Get agent info' })
    @ApiOkResponse({
        description: 'Example of successful response.',
        schema: {
            type: 'object',
            properties: {
                status: { type: 'string', example: 'OK' },
                data: {
                    type: 'object',
                    properties: {
                        collaterals: {
                            type: 'array',
                            example: [
                                { symbol: 'CFLR', balance: '8852854861132833335327742', wrapped: '0' },
                                { symbol: 'testUSDC', balance: '92524025246' },
                                { symbol: 'testUSDT', balance: '0' },
                                { symbol: 'testETH', balance: '0' }
                            ],
                            items: {
                                type: 'object',
                                properties: {
                                    symbol: { type: 'string' },
                                    balance: { type: 'string' }
                                }
                            }
                        },
                        whitelisted: { type: 'boolean', example: true }
                    }
                }
            }
        }
    })
    public async getAgentData(
        @Param("fAssetSymbol") fAssetSymbol: string
    ): Promise<ApiResponseWrapper<AgentData>> {
        return handleApiResponse(this.agentService.getAgentInfo(fAssetSymbol));
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Get("info/vaults/:fAssetSymbol")
    @ApiOkResponse({
        description: 'Example of successful response.',
        schema: {
            type: 'object',
            properties: {
                status: { type: 'string', example: 'OK' },
                data: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            vaultAddress: { type: 'string', example: '0x7fBd0b3aB8f06A291d96EdE7B1bb5dBb84F525F0' },
                            poolCollateralRatioBIPS: { type: 'string', example: '10000000000' },
                            vaultCollateralRatioBIPS: { type: 'string', example: '10000000000' },
                            agentSettingUpdateValidAtFeeBIPS: { type: 'string', example: '0' },
                            agentSettingUpdateValidAtPoolFeeShareBIPS: { type: 'string', example: '0' },
                            agentSettingUpdateValidAtMintingVaultCrBIPS: { type: 'string', example: '0' },
                            agentSettingUpdateValidAtMintingPoolCrBIPS: { type: 'string', example: '0' },
                            agentSettingUpdateValidAtBuyFAssetByAgentFactorBIPS: { type: 'string', example: '0' },
                            agentSettingUpdateValidAtPoolExitCrBIPS: { type: 'string', example: '0' },
                            agentSettingUpdateValidAtPoolTopupCrBIPS: { type: 'string', example: '0' },
                            agentSettingUpdateValidAtPoolTopupTokenPriceFactorBIPS: { type: 'string', example: '0' },
                            agentSettingUpdateValidAtHandshakeType: { type: 'string', example: '0' }
                        }
                    }
                }
            }
        }
    })
    public async getAgentStatus(
        @Param("fAssetSymbol") fAssetSymbol: string
    ): Promise<ApiResponseWrapper<AgentVaultStatus[]>> {
        return handleApiResponse(this.agentService.getAgentVaultsInfo(fAssetSymbol));
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Get("info/vault/:fAssetSymbol/:agentVaultAddress")
    @ApiOkResponse({
        description: 'Example of successful response.',
        schema: {
            type: 'object',
            properties: {
                status: { type: 'string', example: 'OK' },
                data: {
                    type: 'object',
                    properties: {
                        status: { type: 'string', example: '0' },
                        ownerManagementAddress: { type: 'string', example: '0x19E2b0f41c09250Bf2A024187593d9B6DCA48da8' },
                        ownerWorkAddress: { type: 'string', example: '0x1D2047b54667e527d689a3319961e9B8FaE43462' },
                        collateralPool: { type: 'string', example: '0x8B32D2626ee9D3e36dBA65754c789ADA88B9399a' },
                        underlyingAddressString: { type: 'string', example: 'rJjxrt8HTbzXMuUFjkNkvmpR9EzxSW9Rwb' },
                        publiclyAvailable: { type: 'boolean', example: false },
                        feeBIPS: { type: 'string', example: '25' },
                        poolFeeShareBIPS: { type: 'string', example: '4000' },
                        vaultCollateralToken: { type: 'string', example: 'testUSDC' },
                        mintingVaultCollateralRatioBIPS: { type: 'string', example: '16000' },
                        mintingPoolCollateralRatioBIPS: { type: 'string', example: '24000' },
                        freeCollateralLots: { type: 'string', example: '0' },
                        totalVaultCollateralWei: { type: 'string', example: '0' },
                        freeVaultCollateralWei: { type: 'string', example: '0' },
                        vaultCollateralRatioBIPS: { type: 'string', example: '10000000000' },
                        totalPoolCollateralNATWei: { type: 'string', example: '0' },
                        freePoolCollateralNATWei: { type: 'string', example: '0' },
                        poolCollateralRatioBIPS: { type: 'string', example: '10000000000' },
                        totalAgentPoolTokensWei: { type: 'string', example: '0' },
                        announcedVaultCollateralWithdrawalWei: { type: 'string', example: '0' },
                        announcedPoolTokensWithdrawalWei: { type: 'string', example: '0' },
                        freeAgentPoolTokensWei: { type: 'string', example: '0' },
                        mintedUBA: { type: 'string', example: '0' },
                        reservedUBA: { type: 'string', example: '0' },
                        redeemingUBA: { type: 'string', example: '0' },
                        poolRedeemingUBA: { type: 'string', example: '0' },
                        dustUBA: { type: 'string', example: '0' },
                        ccbStartTimestamp: { type: 'string', example: '0' },
                        liquidationStartTimestamp: { type: 'string', example: '0' },
                        maxLiquidationAmountUBA: { type: 'string', example: '0' },
                        liquidationPaymentFactorVaultBIPS: { type: 'string', example: '0' },
                        liquidationPaymentFactorPoolBIPS: { type: 'string', example: '0' },
                        underlyingBalanceUBA: { type: 'string', example: '0' },
                        requiredUnderlyingBalanceUBA: { type: 'string', example: '0' },
                        freeUnderlyingBalanceUBA: { type: 'string', example: '0' },
                        announcedUnderlyingWithdrawalId: { type: 'string', example: '0' },
                        buyFAssetByAgentFactorBIPS: { type: 'string', example: '9900' },
                        poolExitCollateralRatioBIPS: { type: 'string', example: '26000' },
                        poolTopupCollateralRatioBIPS: { type: 'string', example: '22000' },
                        poolTopupTokenPriceFactorBIPS: { type: 'string', example: '8000' },
                        handshakeType: { type: 'string', example: 0 },
                        poolSuffix: { type: 'string', example: 'POOLSUFFIXNAME'}
                    }
                }
            }
        }
    })
    public async getAgentVaultInfo(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string
    ): Promise<ApiResponseWrapper<ExtendedAgentVaultInfo>> {
        return handleApiResponse(this.agentService.getAgentVaultInfo(fAssetSymbol, agentVaultAddress));
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Get("info/underlying/balance/:fAssetSymbol")
    @ApiOkResponse({
        description: 'Example of successful response.',
        schema: {
            type: 'object',
            properties: {
                status: { type: 'string', example: 'OK' },
                data: {
                    type: 'object',
                    properties: {
                        balance: { type: 'string', example: '22476095600' }
                    }
                }
            }
        }
    })
    public async getAgentUnderlyingBalance(
        @Param("fAssetSymbol") fAssetSymbol: string
    ): Promise<ApiResponseWrapper<AgentBalance>> {
        return handleApiResponse(this.agentService.getAgentUnderlyingBalance(fAssetSymbol));
    }

    @ApiSecurity("X-API-KEY")
    @UseGuards(AuthGuard("notifier_key"))
    @Post("botAlert")
    public async sendNotification(
        @Body() alert: PostAlert
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.saveAlert(alert));
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Get("botAlert")
    @ApiOkResponse({
        description: 'Example of successful response.',
        schema: {
            type: 'object',
            properties: {
                status: { type: 'string', example: 'OK' },
                data: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            bot_type: { type: 'string', example: 'liquidator' },
                            address: { type: 'string', example: '0x7fBd0b3aB8f06A291d96EdE7B1bb5dBb84F525F0' },
                            level: { type: 'string', example: 'info' },
                            title: { type: 'string', example: 'AGENT CREATED' },
                            description: { type: 'string', example: 'Agent 0x7fBd0b3aB8f06A291d96EdE7B1bb5dBb84F525F0 was created.' }
                        }
                    }
                }
            }
        }
    })
    public async getNotifications(
    ): Promise<ApiResponseWrapper<PostAlert[]>> {
        return handleApiResponse(this.agentService.getAlerts());
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Get("workAddress")
    @ApiOkResponse({
        description: 'Example of successful response.',
        schema: {
            type: 'object',
            properties: {
                status: { type: 'string', example: 'OK' },
                data: { type: 'string', example: '0x1D2047b54667e527d689a3319961e9B8FaE43462' }
            }
        }
    })
    public async getAgentWorkAddress(
    ): Promise<ApiResponseWrapper<string>> {
        return handleApiResponse(this.agentService.getAgentWorkAddress());
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Get("fassetSymbols")
    @ApiOkResponse({
        description: 'Example of successful response.',
        schema: {
            type: 'object',
            properties: {
                status: { type: 'string', example: 'OK' },
                data: {
                    type: 'array',
                    example: ["FTestXRP", "FSimCoinX"]
                }
            }
        }
    })
    public async getFassetSymbols(
    ): Promise<ApiResponseWrapper<string[]>> {
        return handleApiResponse(this.agentService.getFassetSymbols());
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Get("whitelisted")
    @ApiOkResponse({
        description: 'Example of successful response.',
        schema: {
            type: 'object',
            properties: {
                status: { type: 'string', example: 'OK' },
                data: { type: 'boolean', example: 'true' }
            }
        }
    })
    public async getWhitelistedStatus(
    ): Promise<ApiResponseWrapper<boolean>> {
        return handleApiResponse(this.agentService.checkWhitelisted());
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Get("secretsExist")
    public async getSecretsExist(
    ): Promise<ApiResponseWrapper<boolean>> {
        return handleApiResponse(this.agentService.checkSecretsFile());
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Get("collaterals")
    public async getCollaterals(
    ): Promise<ApiResponseWrapper<AllCollaterals[]>> {
        return handleApiResponse(this.agentService.getAllCollaterals());
    }

    @Get("botStatus")
    public async getBotStatus(
    ): Promise<ApiResponseWrapper<boolean>> {
        return handleApiResponse(this.agentService.checkBotStatus());
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Get("APIKey")
    public async generateAPIKey(
    ): Promise<ApiResponseWrapper<APIKey>> {
        return handleApiResponse(this.agentService.generateAPIKey());
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Get("vaultCollaterals")
    public async getVaultCollaterals(
    ): Promise<ApiResponseWrapper<VaultCollaterals[]>> {
        return handleApiResponse(this.agentService.getVaultCollateralTokens());
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Get("vaults")
    public async getAllVaults(
    ): Promise<ApiResponseWrapper<any>> {
        return handleApiResponse(this.agentService.getAgentVaults());
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Get("managementAddress")
    @ApiOkResponse({
        description: 'Example of successful response.',
        schema: {
            type: 'object',
            properties: {
                status: { type: 'string', example: 'OK' },
                data: { type: 'string', example: '0x1D2047b54667e527d689a3319961e9B8FaE43462' }
            }
        }
    })
    public async getAgentManagementAddress(
    ): Promise<ApiResponseWrapper<string>> {
        return handleApiResponse(this.agentService.getAgentManagementAddress());
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Get("balances")
    public async getAllBalances(
    ): Promise<ApiResponseWrapper<AllBalances[]>> {
        return handleApiResponse(this.agentService.getAllBalances());
    }

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Get("underlyingAddresses")
    public async getUnderlyingAddresses(
    ): Promise<ApiResponseWrapper<UnderlyingAddress[]>> {
        return handleApiResponse(this.agentService.getUnderlyingAddresses());
    }
}
