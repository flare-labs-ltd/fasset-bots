import "dotenv/config";

import { StuckTransaction } from "@flarelabs/simple-wallet";
import { EntityManager } from "@mikro-orm/core";
import BN from "bn.js";
import { Secrets } from ".";
import { IIAssetManagerInstance } from "../../typechain-truffle";
import { AssetManagerSettings } from "../fasset/AssetManagerTypes";
import { ChainInfo, NativeChainInfo } from "../fasset/ChainInfo";
import { overrideAndCreateOrm } from "../mikro-orm.config";
import { BlockchainIndexerHelper } from "../underlying-chain/BlockchainIndexerHelper";
import { BlockchainWalletHelper } from "../underlying-chain/BlockchainWalletHelper";
import { ChainId } from "../underlying-chain/ChainId";
import { VerificationPrivateApiClient } from "../underlying-chain/VerificationPrivateApiClient";
import { FlareDataConnectorClientHelper } from "../underlying-chain/FlareDataConnectorClientHelper";
import { DBWalletKeys } from "../underlying-chain/WalletKeys";
import {
    IBlockChainWallet,
} from "../underlying-chain/interfaces/IBlockChainWallet";
import { IFlareDataConnectorClient } from "../underlying-chain/interfaces/IFlareDataConnectorClient";
import { IVerificationApiClient } from "../underlying-chain/interfaces/IVerificationApiClient";
import { Currency, RequireFields, assertCmd, assertNotNull, assertNotNullCmd, requireNotNull, toBNExp } from "../utils";
import { agentNotifierThrottlingTimes } from "../utils/notifier/AgentNotifier";
import { NotifierTransport } from "../utils/notifier/BaseNotifier";
import { ApiNotifierTransport, ConsoleNotifierTransport, LoggerNotifierTransport, ThrottlingNotifierTransport } from "../utils/notifier/NotifierTransports";
import { AssetContractRetriever } from "./AssetContractRetriever";
import { AgentBotFassetSettingsJson, AgentBotSettingsJson, AgentSettingsConfigDefaults, ApiNotifierConfig, BotConfigFile, BotFAssetInfo, BotNativeChainInfo, OrmConfigOptions } from "./config-files/BotConfigFile";
import { LiquidatorBotStrategyDefinition, ChallengerBotStrategyDefinition } from "./config-files/BotStrategyConfig";
import { DatabaseAccount } from "./config-files/SecretsFile";
import { createWalletClient, requireSupportedChainId } from "./create-wallet-client";
import { EM, ORM } from "./orm";
import { AgentBotDbUpgrades } from "../actors/AgentBotDbUpgrades";
import { ChainalysisClient, HandshakeAddressVerifier } from "../actors/plugins/HandshakeAddressVerifier";

export interface BotConfig<T extends BotFAssetConfig = BotFAssetConfig> {
    secrets: Secrets;
    orm?: ORM; // only for agent bot
    notifiers: NotifierTransport[];
    loopDelay: number;
    fAssets: Map<string, T>;
    nativeChainInfo: NativeChainInfo;
    contractRetriever: AssetContractRetriever;
    // liquidation strategies for liquidator and challenger
    liquidationStrategy?: LiquidatorBotStrategyDefinition; // only for liquidator (optional)
    challengeStrategy?: ChallengerBotStrategyDefinition; // only for challenger (optional)
}

export interface BotFAssetConfig {
    fAssetSymbol: string;
    chainInfo: ChainInfo;
    wallet?: IBlockChainWallet; // for agent bot and user
    blockchainIndexerClient?: BlockchainIndexerHelper; // for agent bot, user and challenger
    flareDataConnector?: IFlareDataConnectorClient; // for agent bot, user, challenger and timeKeeper
    verificationClient?: IVerificationApiClient; // only for agent bot and user
    assetManager: IIAssetManagerInstance;
    priceChangeEmitter: string; // the name of the contract (in Contracts file) that emits price change event
    agentBotSettings?: AgentBotSettings;
}

export interface AgentBotSettings {
    parallel: boolean;
    trustedPingSenders: Set<string>;
    liquidationPreventionFactor: number;
    vaultCollateralReserveFactor: number;
    poolCollateralReserveFactor: number;
    recommendedOwnerUnderlyingBalance: BN;
    minimumFreeUnderlyingBalance: BN;
    minBalanceOnServiceAccount: BN;
    minBalanceOnWorkAccount: BN;
    defaultAgentSettings: AgentSettingsConfigDefaults;
    feeSafetyFactorPerKB: number;
}

export type BotFAssetAgentConfig = RequireFields<BotFAssetConfig, "wallet" | "blockchainIndexerClient" | "flareDataConnector" | "verificationClient" | "agentBotSettings">;
export type BotFAssetConfigWithWallet = RequireFields<BotFAssetConfig, "wallet" | "blockchainIndexerClient" | "flareDataConnector" | "verificationClient">;
export type BotFAssetConfigWithIndexer = RequireFields<BotFAssetConfig, "blockchainIndexerClient" | "flareDataConnector" | "verificationClient">;

export type AgentBotConfig = RequireFields<BotConfig<BotFAssetAgentConfig>, "orm">; // for agent
export type UserBotConfig = BotConfig<BotFAssetConfigWithWallet>;                   // for minter and redeemer
export type KeeperBotConfig = BotConfig<BotFAssetConfigWithIndexer>;                // for challenger and timekeeper

export type BotConfigType = "agent" | "user" | "keeper" | "common";

/**
 * Creates bot configuration from initial run config file.
 * @param type bot
 * @param secrets loaded agent bot secrets file (for api keys and db credentials)
 * @param configFile instance of BotConfigFile
 * @param submitter native owner address
 * @returns instance BotConfig
 */
export async function createBotConfig(type: "agent", secrets: Secrets, configFile: BotConfigFile, submitter?: string): Promise<AgentBotConfig>;
export async function createBotConfig(type: "user", secrets: Secrets, configFile: BotConfigFile, submitter?: string): Promise<UserBotConfig>;
export async function createBotConfig(type: "keeper", secrets: Secrets, configFile: BotConfigFile, submitter?: string): Promise<KeeperBotConfig>;
export async function createBotConfig(type: "common", secrets: Secrets, configFile: BotConfigFile, submitter?: string): Promise<BotConfig>;
export async function createBotConfig(type: BotConfigType, secrets: Secrets, configFile: BotConfigFile, submitter?: string) {
    const orm = await createBotOrm(type, configFile.ormOptions, secrets.data.database);
    try {
        const retriever = await AssetContractRetriever.create(configFile.prioritizeAddressUpdater, configFile.contractsJsonFile, configFile.assetManagerController);
        const fAssets: Map<string, BotFAssetConfig> = new Map();
        for (const [symbol, fassetInfo] of Object.entries(configFile.fAssets)) {
            const fassetConfig = await createBotFAssetConfig(type, secrets, retriever, symbol, fassetInfo, configFile.agentBotSettings,
                orm?.em, configFile.dataAccessLayerUrls, submitter);
            fAssets.set(symbol, fassetConfig);
        }
        const result: BotConfig = {
            secrets: secrets,
            loopDelay: configFile.loopDelay,
            fAssets: fAssets,
            nativeChainInfo: createNativeChainInfo(configFile.nativeChainInfo),
            orm: orm,
            notifiers: standardNotifierTransports(secrets, configFile.apiNotifierConfigs),
            contractRetriever: retriever,
            liquidationStrategy: configFile.liquidationStrategy,
            challengeStrategy: configFile.challengeStrategy,
        };
        return result;
    } catch (error) {
        await orm?.close();
        throw error;
    }
}

export function createNativeChainInfo(nativeChainInfo: BotNativeChainInfo): NativeChainInfo {
    return { ...nativeChainInfo };
}

export async function createBotOrm(type: BotConfigType, ormOptions?: OrmConfigOptions, databaseAccount?: DatabaseAccount) {
    if (type === "agent") {
        assertNotNullCmd(ormOptions, "Setting 'ormOptions' is required in config");
        const orm = await overrideAndCreateOrm(ormOptions, databaseAccount);
        await AgentBotDbUpgrades.performUpgrades(orm);
        return orm;
    } else if (type === "user") {
        assertNotNullCmd(ormOptions, "Setting 'ormOptions' is required in config");
        const orm = await overrideAndCreateOrm(ormOptions, databaseAccount);
        return orm;
    }
}

export function standardNotifierTransports(secrets: Secrets, apiNotifierConfigs: ApiNotifierConfig[] | undefined) {
    const transports: NotifierTransport[] = [];
    transports.push(new ThrottlingNotifierTransport(new ConsoleNotifierTransport(), agentNotifierThrottlingTimes));
    transports.push(new LoggerNotifierTransport());
    if (apiNotifierConfigs !== undefined) {
        for (const apiNotifierConfig of apiNotifierConfigs) {
            const transport = new ApiNotifierTransport(apiNotifierConfig);
            transports.push(new ThrottlingNotifierTransport(transport, agentNotifierThrottlingTimes));
        }
    }
    return transports;
}

/**
 * Creates BotFAssetConfig configuration from chain info.
 * @param type
 * @param secrets
 * @param retriever
 * @param fAssetSymbol
 * @param fassetInfo instance of BotFAssetInfo
 * @param agentSettings
 * @param em entity manager
 * @param dataAccessLayerUrls list of attestation provider's urls
 * @param submitter address from which the transactions get submitted
 * @returns instance of BotFAssetConfig
 */
export async function createBotFAssetConfig(
    type: BotConfigType,
    secrets: Secrets,
    retriever: AssetContractRetriever,
    fAssetSymbol: string,
    fassetInfo: BotFAssetInfo,
    agentSettings: AgentBotSettingsJson | undefined,
    em: EM | undefined,
    dataAccessLayerUrls: string[] | undefined,
    submitter: string | undefined,
): Promise<BotFAssetConfig> {
    const assetManager = retriever.getAssetManager(fAssetSymbol);
    const settings = await assetManager.getSettings();
    const chainId = ChainId.from(fassetInfo.chainId);
    const result: BotFAssetConfig = {
        fAssetSymbol: fAssetSymbol,
        chainInfo: createChainInfo(chainId, fassetInfo, settings),
        assetManager: assetManager,
        priceChangeEmitter: fassetInfo.priceChangeEmitter,
    };
    if (type === "agent" || type === "user") {
        assertCmd(fassetInfo.walletUrls != null && fassetInfo.walletUrls.length > 0, `At least one walletUrl in FAsset type ${fAssetSymbol} is required`);
        result.wallet = await createBlockchainWalletHelper(secrets, chainId, requireNotNull(em), fassetInfo.walletUrls, fassetInfo.stuckTransactionOptions);
    }
    if (type === "agent") {
        assertNotNullCmd(agentSettings, `Missing agentBotSettings in config`);
        assertNotNullCmd(agentSettings.fAssets[fAssetSymbol], `Missing agent bot settings for fasset ${fAssetSymbol}`);
        result.agentBotSettings = createAgentBotSettings(agentSettings, agentSettings.fAssets[fAssetSymbol], result.chainInfo);
    }
    if (type === "agent" || type === "user" || type === "keeper") {
        assertCmd(fassetInfo.indexerUrls != null && fassetInfo.indexerUrls.length > 0, "At least one indexer url is required");
        assertCmd(dataAccessLayerUrls != null && dataAccessLayerUrls.length > 0, "At least one attestation provider url is required");
        assertNotNull(submitter);   // if this is missing, it is program error
        const fdcHubAddress = await retriever.getContractAddress("FdcHub");
        const relayAddress = await retriever.getContractAddress("Relay");
        const indexerApiKeys: string[] = indexerApiKey(secrets, fassetInfo.indexerUrls);
        const dataAccessLayerApiKeys: string[] = dataAccessLayerApiKey(secrets, dataAccessLayerUrls);
        result.blockchainIndexerClient = createBlockchainIndexerHelper(chainId, fassetInfo.indexerUrls, indexerApiKeys);
        result.verificationClient = await createVerificationApiClient(fassetInfo.indexerUrls, indexerApiKeys);
        result.flareDataConnector = await createFlareDataConnectorClient(fassetInfo.indexerUrls, indexerApiKeys,
            dataAccessLayerUrls, dataAccessLayerApiKeys, settings.fdcVerification, fdcHubAddress, relayAddress, submitter);
    }
    return result;
}

export function createChainInfo(chainId: ChainId, fassetInfo: BotFAssetInfo, settings: AssetManagerSettings): ChainInfo {
    const decimals = Number(settings.assetDecimals);
    return {
        chainId: chainId,
        name: fassetInfo.tokenName,
        symbol: fassetInfo.tokenSymbol,
        decimals: decimals,
        amgDecimals: Number(settings.assetMintingDecimals),
        requireEOAProof: settings.requireEOAAddressProof,
        minimumAccountBalance: toBNExp(fassetInfo.minimumAccountBalance ?? "0", decimals),
        useOwnerUnderlyingAddressForPayingFees: fassetInfo.useOwnerUnderlyingAddressForPayingFees ?? false,
    }
}

function createAgentBotSettings(agentBotSettings: AgentBotSettingsJson, fassetSettings: AgentBotFassetSettingsJson, chainInfo: ChainInfo): AgentBotSettings {
    const underlying = new Currency(chainInfo.symbol, chainInfo.decimals);
    const native = new Currency("NAT", 18);
    return {
        parallel: agentBotSettings.parallel,
        trustedPingSenders: new Set(agentBotSettings.trustedPingSenders.map(a => a.toLowerCase())),
        liquidationPreventionFactor: Number(agentBotSettings.liquidationPreventionFactor),
        vaultCollateralReserveFactor: Number(agentBotSettings.vaultCollateralReserveFactor),
        poolCollateralReserveFactor: Number(agentBotSettings.poolCollateralReserveFactor),
        minimumFreeUnderlyingBalance: underlying.parse(fassetSettings.minimumFreeUnderlyingBalance),
        recommendedOwnerUnderlyingBalance: underlying.parse(fassetSettings.recommendedOwnerBalance),
        minBalanceOnServiceAccount: native.parse(agentBotSettings.minBalanceOnServiceAccount),
        minBalanceOnWorkAccount: native.parse(agentBotSettings.minBalanceOnWorkAccount),
        defaultAgentSettings: { ...agentBotSettings.defaultAgentSettings, ...fassetSettings.defaultAgentSettings },
        feeSafetyFactorPerKB: Number(fassetSettings.feeSafetyFactorPerKB)
    }
}

/**
 * Creates blockchain indexer helper. Relevant urls and api keys are provided in .env.
 * @param chainId chain source
 * @param indexerUrl indexer's url
 * @returns instance of BlockchainIndexerHelper
 */
export function createBlockchainIndexerHelper(chainId: ChainId, indexerUrls: string[], apiKeys: string[]): BlockchainIndexerHelper {
    requireSupportedChainId(chainId);
    return new BlockchainIndexerHelper(indexerUrls, chainId, apiKeys);
}

/**
 * Creates blockchain wallet helper using wallet client.
 * @param secrets
 * @param chainId chain source
 * @param em entity manager (optional)
 * @param walletUrl chain's url
 * @param options
 * @returns instance of BlockchainWalletHelper
 */
export async function createBlockchainWalletHelper(
    secrets: Secrets,
    chainId: ChainId,
    em: EntityManager,
    walletUrls: string[],
    options?: StuckTransaction,
): Promise<BlockchainWalletHelper> {
    requireSupportedChainId(chainId);
    const walletClient = await createWalletClient(secrets, chainId, walletUrls, em, options);
    const walletKeys = DBWalletKeys.from(requireNotNull(em), secrets);
    return new BlockchainWalletHelper(walletClient, walletKeys);
}

/**
 * Creates flare data connector client
 * @param indexerWebServerUrl indexer's url
 * @param indexerApiKey
 * @param dataAccessLayerUrls list of attestation provider's urls
 * @param fdcVerificationAddress FdcVerification's contract address
 * @param fdcHubAddress FdcHub's contract address
 * @param relayAddress Relay's contract address
 * @param submitter native address of the account that will call requestAttestations
 * @returns instance of FlareDataConnectorClientHelper
 */
export async function createFlareDataConnectorClient(
    indexerWebServerUrls: string[],
    indexerApiKeys: string[],
    dataAccessLayerUrls: string[],
    dataAccessLayerApiKeys: string[],
    fdcVerificationAddress: string,
    fdcHubAddress: string,
    relayAddress: string,
    submitter: string
): Promise<FlareDataConnectorClientHelper> {
    return await FlareDataConnectorClientHelper.create(dataAccessLayerUrls, dataAccessLayerApiKeys, fdcVerificationAddress, fdcHubAddress, relayAddress, indexerWebServerUrls, indexerApiKeys, submitter);
}

export async function createVerificationApiClient(indexerWebServerUrls: string[], indexerApiKeys: string[]): Promise<VerificationPrivateApiClient> {
    return new VerificationPrivateApiClient(indexerWebServerUrls, indexerApiKeys);
}

/**
 * At the shutdown of the program, you should close the bot config.
 * This closed DB connections etc.
 */
export async function closeBotConfig(config: BotConfig) {
    await config.orm?.close();
}

/**
 * Extract indexer api key.
 */
export function indexerApiKey(secrets: Secrets, indexerUrls: string[]): string[] {
    const apiTokenKey = secrets.requiredOrRequiredArray("apiKey.indexer");
    if (Array.isArray(apiTokenKey) && apiTokenKey.length != indexerUrls.length) {
        throw new Error(`Cannot create indexers. The number of URLs and API keys do not match.`);
    }
    return Array.isArray(apiTokenKey) ? apiTokenKey : Array(indexerUrls.length).fill(apiTokenKey);
}

/**
 * Extract data access layer api key.
 */
export function dataAccessLayerApiKey(secrets: Secrets, dataAccessLayerUrls: string[]): string[] {
    const apiTokenKey = secrets.requiredOrRequiredArray("apiKey.data_access_layer");
    if (Array.isArray(apiTokenKey) && apiTokenKey.length != dataAccessLayerUrls.length) {
        throw new Error(`Cannot create dataAccessLayer. The number of URLs and API keys do not match.`);
    }
    return Array.isArray(apiTokenKey) ? apiTokenKey : Array(dataAccessLayerUrls.length).fill(apiTokenKey);
}

/**
 * Get the handshake address verifier client.
 */
export function getHandshakeAddressVerifier(secrets: Secrets): HandshakeAddressVerifier | null {
    const havClientUrl = secrets.optional("handshakeAddressVerifierApi.url");
    if (havClientUrl == null || havClientUrl == "") {
        return null;
    }
    const havClientApiKey = secrets.required("handshakeAddressVerifierApi.api_key");
    return new ChainalysisClient(havClientUrl, havClientApiKey);
}
