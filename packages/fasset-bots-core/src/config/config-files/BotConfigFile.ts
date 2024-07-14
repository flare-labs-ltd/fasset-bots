export type DatabaseType = "mysql" | "sqlite" | "postgresql";

export type SchemaUpdate = "none" | "safe" | "full" | "recreate";

export interface OrmConfigOptions {
    type: DatabaseType;
    schemaUpdate?: SchemaUpdate;
    debug?: boolean;
    // connection building - either clientUrl or some combination of others
    clientUrl?: string;
    dbName?: string;
    host?: string;
    port?: number;
    charset?: string;
    pool?: {
        min?: number;
        max?: number;
        acquireTimeoutMillis?: number;
    }
    // allow other options
    [key: string]: any;
}

export interface BotFAssetInfo {
    chainId: string;
    tokenName: string;       // underlying token name
    tokenSymbol: string;     // underlying token symbol
    tokenDecimals: number;   // decimals for both underlying token and fasset
    walletUrl?: string; // for agent bot and user
    indexerUrl?: string; // for agent bot, user, challenger and timeKeeper
    priceChangeEmitter?: string; // the name of the contract (in Contracts file) that emits 'PriceEpochFinalized' event (optional, default is 'FtsoManager')
    minimumAccountBalance?: string; // only needed for XRP
    faucet?: string;
}

export interface BotNativeChainInfo {
    chainName: string;
    tokenSymbol: string;
    finalizationBlocks: number;
    // maximum number of blocks in getPastLogs() call
    readLogsChunkSize: number;
    recommendedOwnerBalance?: string;
    faucet?: string;
}


export interface ApiNotifierConfig {
    apiUrl: string
    apiKey: string
}

export interface BotStrategyDefinition {
    className: string;
    config?: any;
}

export interface BotConfigFile {
    ormOptions?: OrmConfigOptions; // only for agent bot
    walletOptions?: {
        blockOffset?: number; // How many block to wait for transaction to be validated
        retries?: number; // How many times should transaction retry to successfully submit
        feeIncrease?: number; // Factor to increase fee in resubmitting process
    }; // optional wallet options, only for agent
    fAssets: { [fAssetSymbol: string]: BotFAssetInfo };
    // notifierFile: string;
    loopDelay: number;
    nativeChainInfo: BotNativeChainInfo;
    agentBotSettings: AgentBotSettingsJson;
    rpcUrl: string;
    attestationProviderUrls?: string[]; // only for agent bot, challenger and timeKeeper
    prioritizeAddressUpdater: boolean;
    // at least one must be set
    assetManagerController?: string;
    contractsJsonFile?: string;
    // notifier apis
    apiNotifierConfigs?: ApiNotifierConfig[]
    // liquidation strategies for liquidator and challenger
    liquidationStrategy?: BotStrategyDefinition; // only for liquidator
    challengeStrategy?: BotStrategyDefinition; // only for challenge
}

export interface AgentBotFassetSettingsJson {
    /**
     * The amount of underlying currency on woner's underlying address, below which an alert is triggered.
     * @pattern ^[0-9]+(\.[0-9]+)?$
     */
    recommendedOwnerBalance: string;

    /**
     * The amount of underlying currency on woner's underlying address, below which the address should be topped-up,
     * to prevent negative free underlying balance after redemptions.
     * @pattern ^[0-9]+(\.[0-9]+)?$
     */
    minimumFreeUnderlyingBalance: string;
}

export interface AgentBotSettingsJson {
    /**
     * If true, mintings and various redemption steps will run in parallel.
     * WARNING: should not be used with sqlite database.
     */
    parallel: boolean;

    /**
     * Minimum amount of collateral to topup vault to, to prevent liquidation.
     * Relative to collateral's CCB CR.
     * @pattern ^[0-9]+(\.[0-9]+)?$
     */
    liquidationPreventionFactor: string;

    /**
     * The threshold for USDC/WETH/... on owner's work address, below which alert is triggered.
     * Relative to required vault collateral for current minted amount.
     * @pattern ^[0-9]+(\.[0-9]+)?$
     */
    vaultCollateralReserveFactor: string;

    /**
     * The threshold for NAT on owner's work address, below which alert is triggered.
     * Relative to required pool collateral for current minted amount.
     * @pattern ^[0-9]+(\.[0-9]+)?$
     */
    poolCollateralReserveFactor: string;

    /**
     * The list of address to whose pings the agent will respond.
     */
    trustedPingSenders: string[];

    /**
     * Per FAsset settings.
     */
    fAssets: { [fAssetSymbol: string]: AgentBotFassetSettingsJson };
}

export type AgentBotSettingsJsonOverride =
    Partial<Omit<AgentBotSettingsJson, "fAssets">> & {
        fAssets?: { [fAssetSymbol: string]: Partial<AgentBotFassetSettingsJson> };
    };

export type BotConfigFileOverride =
    Partial<Omit<BotConfigFile, "fAssets" | "nativeChainInfo">> & {
        extends: string;
        fAssets?: { [fAssetSymbol: string]: Partial<BotFAssetInfo> };
        nativeChainInfo?: Partial<BotNativeChainInfo>;
        agentBotSettings?: AgentBotSettingsJsonOverride;
    };

export type Schema_BotConfigFile = BotConfigFile & { $schema?: string };
export type Schema_BotConfigFileOverride = BotConfigFileOverride & { $schema?: string };
