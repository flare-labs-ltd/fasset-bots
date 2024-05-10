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
    // allow other options
    [key: string]: any;
}

export interface BotFAssetInfo {
    chainId: string;
    name: string;
    symbol: string; // only used as database id
    walletUrl?: string; // for agent bot and user
    inTestnet?: boolean; // for agent bot and user (optional)
    indexerUrl?: string; // for agent bot, user, challenger and timeKeeper
    priceChangeEmitter?: string; // the name of the contract (in Contracts file) that emits 'PriceEpochFinalized' event (optional, default is 'FtsoManager')
    minimumAccountBalance?: string; // only needed for XRP
    recommendedOwnerBalance?: string;
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

export type BotConfigFileOverride =
    Partial<Omit<BotConfigFile, "fAssets" | "nativeChainInfo">> & {
        extends: string;
        fAssets?: { [fAssetSymbol: string]: Partial<BotFAssetInfo> };
        nativeChainInfo?: Partial<BotNativeChainInfo>;
    };

export type Schema_BotConfigFile = BotConfigFile & { $schema?: string };
export type Schema_BotConfigFileOverride = BotConfigFileOverride & { $schema?: string };
