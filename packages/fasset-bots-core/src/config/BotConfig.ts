import "dotenv/config";

import { StuckTransaction } from "@flarelabs/simple-wallet";
import { EntityManager } from "@mikro-orm/core";
import { AssetManagerInstance } from "../../typechain-truffle";
import { AssetManagerSettings } from "../fasset/AssetManagerTypes";
import { ChainInfo, NativeChainInfo } from "../fasset/ChainInfo";
import { overrideAndCreateOrm } from "../mikro-orm.config";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { BlockchainIndexerHelper } from "../underlying-chain/BlockchainIndexerHelper";
import { BlockchainWalletHelper } from "../underlying-chain/BlockchainWalletHelper";
import { SourceId } from "../underlying-chain/SourceId";
import { StateConnectorClientHelper } from "../underlying-chain/StateConnectorClientHelper";
import { VerificationPrivateApiClient } from "../underlying-chain/VerificationPrivateApiClient";
import { DBWalletKeys, MemoryWalletKeys } from "../underlying-chain/WalletKeys";
import { IBlockChainWallet } from "../underlying-chain/interfaces/IBlockChainWallet";
import { IStateConnectorClient } from "../underlying-chain/interfaces/IStateConnectorClient";
import { IVerificationApiClient } from "../underlying-chain/interfaces/IVerificationApiClient";
import { NotifierTransport } from "../utils/notifier/BaseNotifier";
import { standardNotifierTransports } from "../utils/notifier/NotifierTransports";
import { AssetContractRetriever } from "./AssetContractRetriever";
import { BotConfigFile, BotFAssetInfo, BotStrategyDefinition } from "./config-files/BotConfigFile";
import { createWalletClient, encodedChainId, requireSupportedSourceId, supportedSourceId } from "./create-wallet-client";
import { EM, ORM } from "./orm";
import { requireSecret } from "./secrets";

export interface BotConfig {
    orm?: ORM; // only for agent bot
    notifiers: NotifierTransport[];
    loopDelay: number;
    rpcUrl: string;
    fAssets: BotFAssetConfig[];
    nativeChainInfo: NativeChainInfo;
    contractRetriever: AssetContractRetriever;
    // liquidation strategies for liquidator and challenger
    liquidationStrategy?: BotStrategyDefinition; // only for liquidator
    challengeStrategy?: BotStrategyDefinition; // only for challenger
}

export interface BotFAssetConfig {
    fAssetSymbol: string;
    chainInfo: ChainInfo;
    wallet?: IBlockChainWallet; // for agent bot and user
    blockchainIndexerClient?: BlockchainIndexerHelper; // for agent bot, user and challenger
    stateConnector?: IStateConnectorClient; // for agent bot, user, challenger and timeKeeper
    verificationClient?: IVerificationApiClient; // only for agent bot and user
    assetManager: AssetManagerInstance;
    priceChangeEmitter?: string; // the name of the contract (in Contracts file) that emits 'PriceEpochFinalized' event (optiona, default is 'FtsoManager')
}

/**
 * Creates bot configuration from initial run config file.
 * @param runConfig instance of BotConfigFile
 * @param submitter native owner address
 * @returns instance BotConfig
 */
export async function createBotConfig(runConfig: BotConfigFile, submitter?: string): Promise<BotConfig> {
    const orm = runConfig.ormOptions ? await overrideAndCreateOrm(runConfig.ormOptions) : undefined;
    const retriever = await AssetContractRetriever.create(runConfig.prioritizeAddressUpdater, runConfig.contractsJsonFile, runConfig.assetManagerController);
    const fAssets: BotFAssetConfig[] = [];
    for (const fassetInfo of runConfig.fAssetInfos) {
        const fassetConfig = await createBotFAssetConfig(retriever, fassetInfo, orm?.em, runConfig.attestationProviderUrls, submitter, runConfig.walletOptions);
        fAssets.push(fassetConfig);
    }
    return {
        rpcUrl: runConfig.rpcUrl,
        loopDelay: runConfig.loopDelay,
        fAssets: fAssets,
        nativeChainInfo: runConfig.nativeChainInfo,
        orm: orm,
        notifiers: standardNotifierTransports(runConfig.alertsUrl),
        contractRetriever: retriever,
        liquidationStrategy: runConfig.liquidationStrategy,
        challengeStrategy: runConfig.challengeStrategy,
    };
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
    retriever: AssetContractRetriever,
    fassetInfo: BotFAssetInfo,
    em: EM | undefined,
    attestationProviderUrls: string[] | undefined,
    submitter: string | undefined,
    walletOptions?: StuckTransaction
): Promise<BotFAssetConfig> {
    const assetManager = retriever.getAssetManager(fassetInfo.fAssetSymbol);
    const settings = await assetManager.getSettings();
    const stateConnectorAddress = await retriever.getContractAddress("StateConnector");
    const sourceId = encodedChainId(fassetInfo.chainId);
    const wallet = fassetInfo.walletUrl
        ? createBlockchainWalletHelper(sourceId, em, fassetInfo.walletUrl, walletOptions)
        : undefined;
    const blockchainIndexerClient = fassetInfo.indexerUrl
        ? createBlockchainIndexerHelper(sourceId, fassetInfo.indexerUrl)
        : undefined;
    const stateConnector = attestationProviderUrls && fassetInfo.indexerUrl && submitter
        ? await createStateConnectorClient(fassetInfo.indexerUrl, attestationProviderUrls, settings.scProofVerifier, stateConnectorAddress, submitter)
        : undefined;
    const verificationClient = fassetInfo.indexerUrl
        ? await createVerificationApiClient(fassetInfo.indexerUrl)
        : undefined;
    return {
        fAssetSymbol: fassetInfo.fAssetSymbol,
        chainInfo: createChainInfo(sourceId, fassetInfo, settings),
        wallet: wallet,
        blockchainIndexerClient: blockchainIndexerClient,
        stateConnector: stateConnector,
        verificationClient: verificationClient,
        assetManager: assetManager,
        priceChangeEmitter: fassetInfo.priceChangeEmitter,
    };
}

export function createChainInfo(sourceId: string, fassetInfo: BotFAssetInfo, settings: AssetManagerSettings): ChainInfo {
    return {
        chainId: sourceId,
        name: fassetInfo.name,
        symbol: fassetInfo.symbol,
        decimals: Number(settings.assetDecimals),
        amgDecimals: Number(settings.assetMintingDecimals),
        requireEOAProof: settings.requireEOAAddressProof,
    }
}

/**
 * Creates blockchain indexer helper. Relevant urls and api keys are provided in .env.
 * @param sourceId chain source
 * @param indexerUrl indexer's url
 * @returns instance of BlockchainIndexerHelper
 */
export function createBlockchainIndexerHelper(sourceId: SourceId, indexerUrl: string): BlockchainIndexerHelper {
    requireSupportedSourceId(sourceId);
    const apiKey = requireSecret("apiKey.indexer");
    return new BlockchainIndexerHelper(indexerUrl, sourceId, apiKey);
}

/**
 * Creates blockchain wallet helper using wallet client.
 * @param sourceId chain source
 * @param em entity manager (optional)
 * @param walletUrl chain's url
 * @param inTestnet if testnet should be used, optional parameter
 * @returns instance of BlockchainWalletHelper
 */
export function createBlockchainWalletHelper(
    sourceId: SourceId,
    em: EntityManager | null | undefined,
    walletUrl: string,
    options?: StuckTransaction
): BlockchainWalletHelper {
    requireSupportedSourceId(sourceId);
    const walletClient = createWalletClient(sourceId, walletUrl, options);
    const walletKeys = em ? new DBWalletKeys(em) : new MemoryWalletKeys();
    return new BlockchainWalletHelper(walletClient, walletKeys);
}

/**
 * Creates attestation helper.
 * @param sourceId chain source
 * @param attestationProviderUrls list of attestation provider's urls
 * @param scProofVerifierAddress SCProofVerifier's contract address
 * @param stateConnectorAddress StateConnector's contract address
 * @param owner native owner address
 * @param indexerUrl indexer's url
 * @returns instance of AttestationHelper
 */
export async function createAttestationHelper(
    sourceId: SourceId,
    attestationProviderUrls: string[],
    scProofVerifierAddress: string,
    stateConnectorAddress: string,
    owner: string,
    indexerUrl: string,
): Promise<AttestationHelper> {
    if (!supportedSourceId(sourceId)) {
        throw new Error(`SourceId ${sourceId} not supported.`);
    }
    const stateConnector = await createStateConnectorClient(indexerUrl, attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, owner);
    return new AttestationHelper(stateConnector, createBlockchainIndexerHelper(sourceId, indexerUrl), sourceId);
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
    attestationProviderUrls: string[],
    scProofVerifierAddress: string,
    stateConnectorAddress: string,
    submitter: string
): Promise<StateConnectorClientHelper> {
    const apiKey = requireSecret("apiKey.indexer");
    return await StateConnectorClientHelper.create(attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, indexerWebServerUrl, apiKey, submitter);
}

export async function createVerificationApiClient(indexerWebServerUrl: string): Promise<VerificationPrivateApiClient> {
    const apiKey = requireSecret("apiKey.indexer");
    return new VerificationPrivateApiClient(indexerWebServerUrl, apiKey);
}

/**
 * At the shutdown of the program, you should close the bot config.
 * This closed DB connections etc.
 */
export async function closeBotConfig(config: BotConfig) {
    await config.orm?.close();
}
