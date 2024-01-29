import { ChainInfo, NativeChainInfo } from "../fasset/ChainInfo";
import { DatabaseType, SchemaUpdate } from "./orm";

export interface OrmConfigOptions {
    type: DatabaseType;
    schemaUpdate?: SchemaUpdate;
    debug?: boolean;
    // connection building - either clientUrl or some combination of others
    clientUrl?: string;
    dbName?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    charset?: string;
    // allow other options
    [key: string]: any;
}

export interface BotConfigFile {
    ormOptions?: OrmConfigOptions; // only for agent bot
    walletOptions?: {
        blockOffset?: number; // How many block to wait for transaction to be validated
        retries?: number; // How many times should transaction retry to successfully submit
        feeIncrease?: number; // Factor to increase fee in resubmitting process
    }, // optional wallet options, only for agent
    fAssetInfos: BotFAssetInfo[];
    // notifierFile: string;
    loopDelay: number;
    nativeChainInfo: NativeChainInfo;
    rpcUrl: string;
    alertsUrl?: string;
    attestationProviderUrls?: string[]; // only for agent bot, challenger and timeKeeper
    stateConnectorAddress?: string; // only for agent bot, challenger and timeKeeper, default is "StateConnector" in contracts json
    stateConnectorProofVerifierAddress?: string; // only for agent bot, challenger and timeKeeper, default is "SCProofVerifier" in contracts json
    // either one must be set
    addressUpdater?: string;
    contractsJsonFile?: string;
    // liquidation / challenger strategies
    liquidationStrategy?: {
        // only for liquidator
        className: string;
        config?: any;
    };
    challengeStrategy?: {
        // only for challenger
        className: string;
        config?: any;
    };
}

export interface BotFAssetInfo extends ChainInfo {
    walletUrl?: string; // only for agent bot
    inTestnet?: boolean; // only for agent bot, optional also for agent bot
    indexerUrl?: string; // only for agent bot, challenger and timeKeeper
    // either one must be set
    assetManager?: string;
    fAssetSymbol?: string;
    // optional settings
    priceChangeEmitter?: string; // the name of the contract (in Contracts file) that emits 'PriceEpochFinalized' event; default is 'FtsoManager'
}

export interface AgentSettingsConfig {
    /**
     * Token suffix for the new collateral pool's token.
     * Must be unique within this fasset type.
     * @pattern ^[\w\-]+$
     */
    poolTokenSuffix: string;

    /**
     * The tokenFtsoSymbol symbol in the collateral type for the created agent vault vault vollateral.
     * @pattern ^[\w\-]\w+$
     */
    vaultCollateralFtsoSymbol: string;

    /**
     * The minting fee percentage.
     * @pattern ^\d+(\.\d+)?\%?$
     */
    fee: string;

    /**
     * The percentage of the minting fee that goes to the collateral pool.
     * @pattern ^\d+(\.\d+)?\%?$
     */
    poolFeeShare: string;

    /**
     * Agent's minting collateral ratio for vault collateral (minimum CR at which the minting can happen).
     * @pattern ^\d+(\.\d+)?\%?$
     */
    mintingVaultCollateralRatio: string;

    /**
     * Agent's minting collateral ratio for pool collateral (minimum CR at which the minting can happen).
     * @pattern ^\d+(\.\d+)?\%?$
     */
    mintingPoolCollateralRatio: string;

    /**
     * Collateral pool's exit collateral ratio (minimum CR for pool collateral at which the collateral pool providers can exit;
     * however, self-close exit is allowed even at lower pool CR).
     * @pattern ^\d+(\.\d+)?\%?$
     */
    poolExitCollateralRatio: string;

    /**
     * FTSO price factor at which the agent pays for burned fassets (in vault tokens) during pool providers' self close exit.
     * @pattern ^\d+(\.\d+)?\%?$
     */
    buyFAssetByAgentFactor: string;

    /**
     * Pool collateral ratio below which the providers can enter at discounted rate.
     * @pattern ^\d+(\.\d+)?\%?$
     */
    poolTopupCollateralRatio: string;

    /**
     * Discounted price factor at which providers can enter when topup is active (i.e. the pool CR is below poolTopupCollateralRatio).
     * @pattern ^\d+(\.\d+)?\%?$
     */
    poolTopupTokenPriceFactor: string;
}

export type Schema_BotConfigFile = BotConfigFile & { $schema?: string };
export type Schema_AgentSettingsConfig = AgentSettingsConfig & { $schema?: string };
