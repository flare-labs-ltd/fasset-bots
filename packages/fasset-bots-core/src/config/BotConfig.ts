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
    FeeServiceOptions,
    IBlockChainWallet,
    WalletApi,
} from "../underlying-chain/interfaces/IBlockChainWallet";
import { IFlareDataConnectorClient } from "../underlying-chain/interfaces/IFlareDataConnectorClient";
import { IVerificationApiClient } from "../underlying-chain/interfaces/IVerificationApiClient";
import { Currency, RequireFields, assertCmd, assertNotNull, assertNotNullCmd, requireNotNull, toBNExp } from "../utils";
import { agentNotifierThrottlingTimes } from "../utils/notifier/AgentNotifier";
import { NotifierTransport } from "../utils/notifier/BaseNotifier";
import { ApiNotifierTransport, ConsoleNotifierTransport, LoggerNotifierTransport, ThrottlingNotifierTransport } from "../utils/notifier/NotifierTransports";
import { AssetContractRetriever } from "./AssetContractRetriever";
import { AgentBotFassetSettingsJson, AgentBotSettingsJson, ApiNotifierConfig, BotConfigFile, BotFAssetInfo, BotNativeChainInfo, BotStrategyDefinition, OrmConfigOptions } from "./config-files/BotConfigFile";
import { DatabaseAccount } from "./config-files/SecretsFile";
import { createWalletClient, requireSupportedChainId } from "./create-wallet-client";
import { EM, ORM } from "./orm";
import { AgentBotDbUpgrades } from "../actors/AgentBotDbUpgrades";

export interface BotConfig<T extends BotFAssetConfig = BotFAssetConfig> {
    secrets: Secrets;
    orm?: ORM; // only for agent bot
    notifiers: NotifierTransport[];
    loopDelay: number;
    fAssets: Map<string, T>;
    nativeChainInfo: NativeChainInfo;
    contractRetriever: AssetContractRetriever;
    // liquidation strategies for liquidator and challenger
    liquidationStrategy?: BotStrategyDefinition; // only for liquidator (optional)
    challengeStrategy?: BotStrategyDefinition; // only for challenger (optional)
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
                orm?.em, configFile.attestationProviderUrls, submitter, configFile.walletOptions, fassetInfo.feeServiceOptions, fassetInfo.fallbackApis);
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
            const transport = new ApiNotifierTransport(apiNotifierConfig.apiUrl, apiNotifierConfig.apiKey);
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
 * @param attestationProviderUrls list of attestation provider's urls
 * @param submitter address from which the transactions get submitted
 * @param walletOptions
 * @param feeServiceOptions
 * @param fallbackApis
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
    attestationProviderUrls: string[] | undefined,
    submitter: string | undefined,
    walletOptions?: StuckTransaction,
    feeServiceOptions?: FeeServiceOptions,
    fallbackApis?: WalletApi[],
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
        assertNotNullCmd(fassetInfo.walletUrl, `Missing walletUrl in FAsset type ${fAssetSymbol}`);
        result.wallet = await createBlockchainWalletHelper(secrets, chainId, requireNotNull(em), fassetInfo.walletUrl, walletOptions, feeServiceOptions, fallbackApis);
    }
    if (type === "agent") {
        assertNotNullCmd(agentSettings, `Missing agentBotSettings in config`);
        assertNotNullCmd(agentSettings.fAssets[fAssetSymbol], `Missing agent bot settings for fasset ${fAssetSymbol}`);
        result.agentBotSettings = createAgentBotSettings(agentSettings, agentSettings.fAssets[fAssetSymbol], result.chainInfo);
    }
    if (type === "agent" || type === "user" || type === "keeper") {
        assertNotNullCmd(fassetInfo.indexerUrl, `Missing indexerUrl in FAsset type ${fAssetSymbol}`);
        assertCmd(attestationProviderUrls != null && attestationProviderUrls.length > 0, "At least one attestation provider url is required");
        assertNotNull(submitter);   // if this is missing, it is program error
        const fdcHubAddress = await retriever.getContractAddress("FdcHub");
        const relayAddress = await retriever.getContractAddress("Relay");
        const apiKey = indexerApiKey(secrets);
        result.blockchainIndexerClient = createBlockchainIndexerHelper(chainId, fassetInfo.indexerUrl, apiKey);
        result.verificationClient = await createVerificationApiClient(fassetInfo.indexerUrl, apiKey);
        result.flareDataConnector = await createFlareDataConnectorClient(fassetInfo.indexerUrl, apiKey, attestationProviderUrls, settings.fdcVerification, fdcHubAddress, relayAddress, submitter);
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
    }
}

/**
 * Creates blockchain indexer helper. Relevant urls and api keys are provided in .env.
 * @param chainId chain source
 * @param indexerUrl indexer's url
 * @returns instance of BlockchainIndexerHelper
 */
export function createBlockchainIndexerHelper(chainId: ChainId, indexerUrl: string, apiKey: string): BlockchainIndexerHelper {
    requireSupportedChainId(chainId);
    return new BlockchainIndexerHelper(indexerUrl, chainId, apiKey);
}

/**
 * Creates blockchain wallet helper using wallet client.
 * @param secrets
 * @param chainId chain source
 * @param em entity manager (optional)
 * @param walletUrl chain's url
 * @param options
 * @param feeServiceOptions
 * @param fallbackApis
 * @returns instance of BlockchainWalletHelper
 */
export async function createBlockchainWalletHelper(
    secrets: Secrets,
    chainId: ChainId,
    em: EntityManager,
    walletUrl: string,
    options?: StuckTransaction,
    feeServiceOptions?: FeeServiceOptions,
    fallbackApis?: WalletApi[],
): Promise<BlockchainWalletHelper> {
    requireSupportedChainId(chainId);
    const walletClient = await createWalletClient(secrets, chainId, walletUrl, em, options, feeServiceOptions, fallbackApis);
    const walletKeys = DBWalletKeys.from(requireNotNull(em), secrets);
    return new BlockchainWalletHelper(walletClient, walletKeys);
}

/**
 * Creates flare data connector client
 * @param indexerWebServerUrl indexer's url
 * @param indexerApiKey
 * @param attestationProviderUrls list of attestation provider's urls
 * @param fdcVerificationAddress FdcVerification's contract address
 * @param fdcHubAddress FdcHub's contract address
 * @param relayAddress Relay's contract address
 * @param submitter native address of the account that will call requestAttestations
 * @returns instance of FlareDataConnectorClientHelper
 */
export async function createFlareDataConnectorClient(
    indexerWebServerUrl: string,
    indexerApiKey: string,
    attestationProviderUrls: string[],
    fdcVerificationAddress: string,
    fdcHubAddress: string,
    relayAddress: string,
    submitter: string
): Promise<FlareDataConnectorClientHelper> {
    return await FlareDataConnectorClientHelper.create(attestationProviderUrls, fdcVerificationAddress, fdcHubAddress, relayAddress, indexerWebServerUrl, indexerApiKey, submitter);
}

export async function createVerificationApiClient(indexerWebServerUrl: string, indexerApiKey: string): Promise<VerificationPrivateApiClient> {
    return new VerificationPrivateApiClient(indexerWebServerUrl, indexerApiKey);
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
export function indexerApiKey(secrets: Secrets) {
    return secrets.required("apiKey.indexer");
}
