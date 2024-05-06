import "dotenv/config";

import { StuckTransaction } from "@flarelabs/simple-wallet";
import { EntityManager } from "@mikro-orm/core";
import { Secrets } from ".";
import { IIAssetManagerInstance } from "../../typechain-truffle";
import { AssetManagerSettings } from "../fasset/AssetManagerTypes";
import { ChainInfo, NativeChainInfo } from "../fasset/ChainInfo";
import { overrideAndCreateOrm } from "../mikro-orm.config";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { BlockchainIndexerHelper } from "../underlying-chain/BlockchainIndexerHelper";
import { BlockchainWalletHelper } from "../underlying-chain/BlockchainWalletHelper";
import { ChainId } from "../underlying-chain/SourceId";
import { StateConnectorClientHelper } from "../underlying-chain/StateConnectorClientHelper";
import { VerificationPrivateApiClient } from "../underlying-chain/VerificationPrivateApiClient";
import { DBWalletKeys, MemoryWalletKeys } from "../underlying-chain/WalletKeys";
import { IBlockChainWallet } from "../underlying-chain/interfaces/IBlockChainWallet";
import { IStateConnectorClient } from "../underlying-chain/interfaces/IStateConnectorClient";
import { IVerificationApiClient } from "../underlying-chain/interfaces/IVerificationApiClient";
import { RequireFields, assertCmd, assertNotNull, assertNotNullCmd, requireNotNull } from "../utils";
import { NotifierTransport } from "../utils/notifier/BaseNotifier";
import { ApiNotifierTransport, ConsoleNotifierTransport, LoggerNotifierTransport } from "../utils/notifier/NotifierTransports";
import { AssetContractRetriever } from "./AssetContractRetriever";
import { BotConfigFile, BotFAssetInfo, BotStrategyDefinition, OrmConfigOptions } from "./config-files/BotConfigFile";
import { DatabaseAccount } from "./config-files/SecretsFile";
import { createWalletClient, requireSupportedChainId, supportedChainId } from "./create-wallet-client";
import { EM, ORM } from "./orm";

export interface BotConfig<T extends BotFAssetConfig = BotFAssetConfig> {
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
    stateConnector?: IStateConnectorClient; // for agent bot, user, challenger and timeKeeper
    verificationClient?: IVerificationApiClient; // only for agent bot and user
    assetManager: IIAssetManagerInstance;
    priceChangeEmitter?: string; // the name of the contract (in Contracts file) that emits 'PriceEpochFinalized' event (optional, default is 'FtsoManager')
}

export type BotFAssetConfigWithWallet = RequireFields<BotFAssetConfig, "wallet" | "blockchainIndexerClient" | "stateConnector" | "verificationClient">;
export type BotFAssetConfigWithIndexer = RequireFields<BotFAssetConfig, "blockchainIndexerClient" | "stateConnector" | "verificationClient">;

export type AgentBotConfig = RequireFields<BotConfig<BotFAssetConfigWithWallet>, "orm">;    // for agent
export type UserBotConfig = BotConfig<BotFAssetConfigWithWallet>;                           // for minter and redeemer
export type KeeperBotConfig = BotConfig<BotFAssetConfigWithIndexer>;                        // for challenger and timekeeper

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
            const fassetConfig = await createBotFAssetConfig(type, secrets, retriever, symbol, fassetInfo, orm?.em, configFile.attestationProviderUrls, submitter, configFile.walletOptions);
            fAssets.set(symbol, fassetConfig);
        }
        return {
            loopDelay: configFile.loopDelay,
            fAssets: fAssets,
            nativeChainInfo: configFile.nativeChainInfo,
            orm: orm,
            notifiers: standardNotifierTransports(secrets, configFile.alertsUrl),
            contractRetriever: retriever,
            liquidationStrategy: configFile.liquidationStrategy,
            challengeStrategy: configFile.challengeStrategy,
        } as AgentBotConfig;
    } catch (error) {
        await orm?.close();
        throw error;
    }
}

export async function createBotOrm(type: BotConfigType, ormOptions?: OrmConfigOptions, databaseAccount?: DatabaseAccount) {
    if (type === "agent") {
        assertNotNullCmd(ormOptions, "Setting 'ormOptions' is required in config");
        return await overrideAndCreateOrm(ormOptions, databaseAccount);
    }
}

export function standardNotifierTransports(secrets: Secrets, alertsUrl: string | undefined) {
    const transports: NotifierTransport[] = [];
    transports.push(new ConsoleNotifierTransport());
    transports.push(new LoggerNotifierTransport());
    if (alertsUrl) {
        transports.push(new ApiNotifierTransport(alertsUrl, secrets.required("apiKey.agent_bot")));
    }
    return transports;
}

/**
 * Creates BotFAssetConfig configuration from chain info.
 * @param fassetInfo instance of BotFAssetInfo
 * @param em entity manager
 * @param attestationProviderUrls list of attestation provider's urls
 * @param scProofVerifierAddress SCProofVerifier's contract address
 * @param stateConnectorAddress  StateConnector's contract address
 * @param submitter address from which the transactions get submitted
 * @returns instance of BotFAssetConfig
 */
export async function createBotFAssetConfig(
    type: BotConfigType,
    secrets: Secrets,
    retriever: AssetContractRetriever,
    fAssetSymbol: string,
    fassetInfo: BotFAssetInfo,
    em: EM | undefined,
    attestationProviderUrls: string[] | undefined,
    submitter: string | undefined,
    walletOptions?: StuckTransaction
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
        result.wallet = createBlockchainWalletHelper(type, secrets, chainId, em, fassetInfo.walletUrl, walletOptions);
    }
    if (type === "agent" || type === "user" || type === "keeper") {
        assertNotNullCmd(fassetInfo.indexerUrl, "Missing indexerUrl in FAsset type ${fAssetSymbol}");
        assertCmd(attestationProviderUrls != null && attestationProviderUrls.length > 0, "At least one attestation provider url is required");
        assertNotNull(submitter);   // if this is missing, it is program error
        const stateConnectorAddress = await retriever.getContractAddress("StateConnector");
        const apiKey = indexerApiKey(secrets);
        result.blockchainIndexerClient = createBlockchainIndexerHelper(chainId, fassetInfo.indexerUrl, apiKey);
        result.verificationClient = await createVerificationApiClient(fassetInfo.indexerUrl, apiKey);
        result.stateConnector = await createStateConnectorClient(fassetInfo.indexerUrl, apiKey, attestationProviderUrls, settings.scProofVerifier, stateConnectorAddress, submitter);
    }
    return result;
}

export function createChainInfo(chainId: ChainId, fassetInfo: BotFAssetInfo, settings: AssetManagerSettings): ChainInfo {
    return {
        chainId: chainId,
        name: fassetInfo.name,
        symbol: fassetInfo.symbol,
        decimals: Number(settings.assetDecimals),
        amgDecimals: Number(settings.assetMintingDecimals),
        requireEOAProof: settings.requireEOAAddressProof,
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
 * @param chainId chain source
 * @param em entity manager (optional)
 * @param walletUrl chain's url
 * @param inTestnet if testnet should be used, optional parameter
 * @returns instance of BlockchainWalletHelper
 */
export function createBlockchainWalletHelper(
    type: "agent" | "user",
    secrets: Secrets,
    chainId: ChainId,
    em: EntityManager | undefined,
    walletUrl: string,
    options?: StuckTransaction
): BlockchainWalletHelper {
    requireSupportedChainId(chainId);
    const walletClient = createWalletClient(secrets, chainId, walletUrl, options);
    const walletKeys = type === "agent" ? DBWalletKeys.from(requireNotNull(em), secrets) : new MemoryWalletKeys();
    return new BlockchainWalletHelper(walletClient, walletKeys);
}

/**
 * Creates attestation helper.
 * @param chainId chain source
 * @param attestationProviderUrls list of attestation provider's urls
 * @param scProofVerifierAddress SCProofVerifier's contract address
 * @param stateConnectorAddress StateConnector's contract address
 * @param owner native owner address
 * @param indexerUrl indexer's url
 * @returns instance of AttestationHelper
 */
export async function createAttestationHelper(
    chainId: ChainId,
    attestationProviderUrls: string[],
    scProofVerifierAddress: string,
    stateConnectorAddress: string,
    owner: string,
    indexerUrl: string,
    indexerApiKey: string,
): Promise<AttestationHelper> {
    if (!supportedChainId(chainId)) {
        throw new Error(`SourceId ${chainId} not supported.`);
    }
    const stateConnector = await createStateConnectorClient(indexerUrl, indexerApiKey, attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, owner);
    const indexer = createBlockchainIndexerHelper(chainId, indexerUrl, indexerApiKey);
    return new AttestationHelper(stateConnector, indexer, chainId);
}

/**
 * Creates state connector client
 * @param indexerWebServerUrl indexer's url
 * @param attestationProviderUrls list of attestation provider's urls
 * @param scProofVerifierAddress SCProofVerifier's contract address
 * @param stateConnectorAddress StateConnector's contract address
 * @param submitter native address of the account that will call requestAttestations
 * @returns instance of StateConnectorClientHelper
 */
export async function createStateConnectorClient(
    indexerWebServerUrl: string,
    indexerApiKey: string,
    attestationProviderUrls: string[],
    scProofVerifierAddress: string,
    stateConnectorAddress: string,
    submitter: string
): Promise<StateConnectorClientHelper> {
    return await StateConnectorClientHelper.create(attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, indexerWebServerUrl, indexerApiKey, submitter);
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
