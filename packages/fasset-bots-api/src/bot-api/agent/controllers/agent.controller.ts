/* eslint-disable @typescript-eslint/no-unused-vars */
import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AgentService } from "../services/agent.service";
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ApiResponseWrapper, handleApiResponse } from "../../common/ApiResponse";
import { APIKey, AgentBalance, AgentCreateResponse, AgentData, AgentSettings, AgentVaultStatus, AllCollaterals, ExtendedAgentVaultInfo, VaultCollaterals } from "../../common/AgentResponse";
import { AgentSettingsConfig } from "@flarelabs/fasset-bots-core/config";
import { PostAlert } from "../../../../../fasset-bots-core/src/utils/notifier/NotifierTransports";
import { AgentSettingsService } from "../services/agentSettings.service";
import { AgentSettingsConfigDTO } from "../../common/AgentettingsConfigDTO";
import { ErrorStatusInterceptor } from "../interceptors/error.status.interceptor";
import { AgentSettingsDTO } from "../../common/AgentSettingsDTO";

@ApiTags("Agent")
@Controller("api/agent")
@UseInterceptors(ErrorStatusInterceptor)
//@ApiSecurity("X-API-KEY")
export class AgentController {
    constructor(
        private readonly agentService: AgentService,
        private agentSettingsService: AgentSettingsService
    ) {}

    @Post("create/:fAssetSymbol")
    //@UseGuards(AuthGuard("api-key"))
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
    @Post("available/enter/:fAssetSymbol/:agentVaultAddress")
    //@UseGuards(AuthGuard("api-key"))
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
    @Post("available/exit/:fAssetSymbol/:agentVaultAddress")
    //@UseGuards(AuthGuard("api-key"))
    public async exit(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.announceExitAvailable(fAssetSymbol, agentVaultAddress));
    }

    @Post("selfClose/:fAssetSymbol/:agentVaultAddress/:amountUBA")
    //@UseGuards(AuthGuard("api-key"))
    public async selfClose(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Param("amountUBA") amountUBA: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.selfClose(fAssetSymbol, agentVaultAddress, amountUBA));
    }

    @Get("settings/list/:fAssetSymbol/:agentVaultAddress")
    //@UseGuards(AuthGuard("api-key"))
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
    @Post("settings/update/:fAssetSymbol/:agentVaultAddress/:settingName/:settingValue")
    //@UseGuards(AuthGuard("api-key"))
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
    @Post("settings/update/:fAssetSymbol/:agentVaultAddress")
    //@UseGuards(AuthGuard("api-key"))
    public async updateAgentSettings(
        @Param("fAssetSymbol") fAssetSymbol: string,
        @Param("agentVaultAddress") agentVaultAddress: string,
        @Body() settingsDTO: AgentSettingsDTO[]
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.updateAgentSettings(fAssetSymbol, agentVaultAddress, settingsDTO));
    }

    @Get("info/data/:fAssetSymbol")
    //@UseGuards(AuthGuard("api-key"))
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

    @Get("info/vaults/:fAssetSymbol")
    //@UseGuards(AuthGuard("api-key"))
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
                            agentSettingUpdateValidAtPoolTopupTokenPriceFactorBIPS: { type: 'string', example: '0' }
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

    @Get("info/vault/:fAssetSymbol/:agentVaultAddress")
    //@UseGuards(AuthGuard("api-key"))
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

    @Get("info/underlying/balance/:fAssetSymbol")
    //@UseGuards(AuthGuard("api-key"))
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

    @Post("botAlert")
    //@UseGuards(AuthGuard("api-key"))
    public async sendNotification(
        @Body() alert: PostAlert
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.saveAlert(alert));
    }

    @Get("botAlert")
    //@UseGuards(AuthGuard("api-key"))
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

    @Get("workAddress")
    //@UseGuards(AuthGuard("api-key"))
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

    @Get("fassetSymbols")
    //@UseGuards(AuthGuard("api-key"))
    @ApiOkResponse({
        description: 'Example of successful response.',
        schema: {
            type: 'object',
            properties: {
                status: { type: 'string', example: 'OK' },
                data: {
                    type: 'array',
                    example: ["FtestXRP", "FfakeXRP"]
                }
            }
        }
    })
    public async getFassetSymbols(
    ): Promise<ApiResponseWrapper<string[]>> {
        return handleApiResponse(this.agentService.getFassetSymbols());
    }

    @Get("whitelisted")
    //@UseGuards(AuthGuard("api-key"))
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

    @Post("secrets")
    public async saveSecrets(
        @Body() secrets: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.saveSecretsFile(secrets));
    }

    @Get("secretsExist")
    public async getSecretsExist(
    ): Promise<ApiResponseWrapper<boolean>> {
        return handleApiResponse(this.agentService.checkSecretsFile());
    }

    @Get("collaterals")
    //@UseGuards(AuthGuard("api-key"))
    public async getCollaterals(
    ): Promise<ApiResponseWrapper<AllCollaterals[]>> {
        return handleApiResponse(this.agentService.getAllCollaterals());
    }

    @Post("workAddress/:publicAddress/:privateKey")
    //@UseGuards(AuthGuard("api-key"))
    public async changeWorkAddress(
        @Param("publicAddress") publicAddress: string,
        @Param("privateKey") privateKey: string
    ): Promise<ApiResponseWrapper<void>> {
        return handleApiResponse(this.agentService.saveWorkAddress(publicAddress, privateKey));
    }

    @Get("generateWorkAddress")
    //@UseGuards(AuthGuard("api-key"))
    public async generateWorkAddress(
    ): Promise<ApiResponseWrapper<any>> {
        return handleApiResponse(this.agentService.generateWorkAddress());
    }

    @Get("botStatus")
    //@UseGuards(AuthGuard("api-key"))
    public async getBotStatus(
    ): Promise<ApiResponseWrapper<boolean>> {
        return handleApiResponse(this.agentService.checkBotStatus());
    }

    @Get("APIKey")
    public async generateAPIKey(
    ): Promise<ApiResponseWrapper<APIKey>> {
        return handleApiResponse(this.agentService.generateAPIKey());
    }

    @Get("vaultCollaterals")
    //@UseGuards(AuthGuard("api-key"))
    public async getVaultCollaterals(
    ): Promise<ApiResponseWrapper<VaultCollaterals[]>> {
        return handleApiResponse(this.agentService.getVaultCollateralTokens());
    }

    @Get("vaults")
    //@UseGuards(AuthGuard("api-key"))
    public async getAllVaults(
    ): Promise<ApiResponseWrapper<any>> {
        return handleApiResponse(this.agentService.getAgentVaults());
    }

    @Get("secretsTemplate")
    //@UseGuards(AuthGuard("api-key"))
    public async generateSecrets(
    ): Promise<ApiResponseWrapper<any>> {
        return handleApiResponse(this.agentService.generateSecrets());
    }
}
