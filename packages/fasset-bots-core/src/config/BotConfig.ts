import "dotenv/config";

import { StuckTransaction, WALLET } from "@flarelabs/simple-wallet";
import { decodeAttestationName, encodeAttestationName } from "@flarenetwork/state-connector-protocol";
import { EntityManager } from "@mikro-orm/core";
import path from "path";
import { AgentBotDefaultSettings, IAssetAgentBotContext } from "../fasset-bots/IAssetBotContext";
import { CollateralClass } from "../fasset/AssetManagerTypes";
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
import { requireNotNull, toBIPS, toBN } from "../utils/helpers";
import { CommandLineError } from "../utils/toplevel";
import { logger } from "../utils/logger";
import { NotifierTransport } from "../utils/notifier/BaseNotifier";
import { standardNotifierTransports } from "../utils/notifier/NotifierTransports";
import { resolveInFassetBotsCore } from "../utils/package-paths";
import { artifacts } from "../utils/web3";
import { AgentSettingsConfig, BotConfigFile, BotFAssetInfo } from "./config-files";
import { loadContracts } from "./contracts";
import { IJsonLoader, JsonLoader } from "./json-loader";
import { CreateOrmOptions, EM, ORM } from "./orm";
import { getSecrets, requireSecret } from "./secrets";

const AddressUpdater = artifacts.require("AddressUpdater");

export interface BotConfig {
    orm?: ORM; // only for agent bot
    notifiers: NotifierTransport[];
    loopDelay: number;
    rpcUrl: string;
    fAssets: BotFAssetConfig[];
    nativeChainInfo: NativeChainInfo;
    // either one must be set
    addressUpdater?: string;
    contractsJsonFile?: string;
    // liquidator / challenger
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

export interface BotFAssetConfig {
    wallet?: IBlockChainWallet; // only for agent bot
    chainInfo: ChainInfo;
    blockchainIndexerClient?: BlockchainIndexerHelper; // only for agent bot and challenger
    stateConnector?: IStateConnectorClient; // only for agent bot, challenger and timeKeeper
    verificationClient?: IVerificationApiClient; // only for agent bot and user bot
    // either one must be set
    assetManager?: string;
    fAssetSymbol?: string;
    // optional settings
    priceChangeEmitter?: string; // the name of the contract (in Contracts file) that emits 'PriceEpochFinalized' event; default is 'FtsoManager'
}

export const botConfigLoader: IJsonLoader<BotConfigFile> =
    new JsonLoader(resolveInFassetBotsCore("run-config/schema/bot-config.schema.json"), "bot config JSON");

export const agentSettingsLoader: IJsonLoader<AgentSettingsConfig> =
    new JsonLoader(resolveInFassetBotsCore("run-config/schema/agent-settings.schema.json"), "agent settings JSON");

/**
 * Loads configuration file and checks it.
 * @param fPath configuration file path
 * @param configInfo
 * @returns instance BotConfigFile
 */
export function loadConfigFile(fPath: string, configInfo?: string, validate: boolean = true): BotConfigFile {
    try {
        const config = botConfigLoader.load(fPath);
        updateConfigFilePaths(fPath, config);
        if (validate) {
            validateConfigFile(config);
            // check secrets.json file permission
            getSecrets();
        }
        return config;
    } /* istanbul ignore next */ catch (e) {
        logger.error(configInfo ?? "", e);
        throw e;
    }
}

/**
 * Validates configuration.
 * @param config instance of interface BotConfigFile
 */
function validateConfigFile(config: BotConfigFile): void {
    if (config.addressUpdater == null && config.contractsJsonFile == null) {
        throw new Error("Missing either contractsJsonFile or addressUpdater in config");
    }
    for (const fc of config.fAssetInfos) {
        if (fc.assetManager == null && fc.fAssetSymbol == null) {
            throw new Error(`Missing either assetManager or fAssetSymbol in FAsset type ${fc.fAssetSymbol}`);
        }
    }
}

export function updateConfigFilePaths(cfPath: string, config: BotConfigFile) {
    const cfDir = path.dirname(cfPath);
    if (config.contractsJsonFile) {
        config.contractsJsonFile = path.resolve(cfDir, config.contractsJsonFile);
    }
    // namespace SQLite db by asset manager controller address (only needed for beta testing)
    if (config.ormOptions?.type === "sqlite" && config.contractsJsonFile) {
        const contracts = loadContracts(config.contractsJsonFile);
        const controllerAddress = contracts.AssetManagerController.address.slice(2, 10);
        config.ormOptions.dbName = config.ormOptions.dbName!.replace(/CONTROLLER/g, controllerAddress);
    }
}

export type AgentBotFAssetInfo = BotFAssetInfo & { walletUrl: string };
export type AgentBotConfigFile = BotConfigFile & { ormOptions: CreateOrmOptions; fAssetInfos: AgentBotFAssetInfo[] };

/**
 * Loads agent configuration file and checks it.
 * @param fPath configuration file path
 * @param configInfo
 * @returns instance AgentBotConfigFile
 */
export function loadAgentConfigFile(fPath: string, configInfo?: string): AgentBotConfigFile {
    try {
        const config = botConfigLoader.load(fPath);
        updateConfigFilePaths(fPath, config);
        validateAgentConfigFile(config);
        // check secrets.json file permission
        getSecrets();
        return config as AgentBotConfigFile;
    } /* istanbul ignore next */ catch (e) {
        logger.error(configInfo ?? "", e);
        throw e;
    }
}

/**
 * Validates agent configuration.
 * @param config instance BotConfigFile
 */
function validateAgentConfigFile(config: BotConfigFile): void {
    validateConfigFile(config);
    for (const fc of config.fAssetInfos) {
        if (fc.walletUrl == null) {
            throw new Error(`Missing walletUrl in FAsset type ${fc.fAssetSymbol}`);
        }
    }
}

/**
 * Creates bot configuration from initial run config file.
 * @param runConfig instance of BotConfigFile
 * @param ownerAddress native owner address
 * @returns instance BotConfig
 */
export async function createBotConfig(runConfig: BotConfigFile, ownerAddress: string): Promise<BotConfig> {
    const orm = runConfig.ormOptions ? await overrideAndCreateOrm(runConfig.ormOptions) : undefined;
    const fAssets: BotFAssetConfig[] = [];
    for (const chainInfo of runConfig.fAssetInfos) {
        chainInfo.chainId = encodedChainId(chainInfo.chainId);
        const proofVerifierAddress = runConfig.stateConnectorProofVerifierAddress
            ? runConfig.stateConnectorProofVerifierAddress :
            (await getStateConnectorAndProofVerifierAddress(runConfig.contractsJsonFile, runConfig.addressUpdater)).pfAddress;
        const stateConnectorAddress = runConfig.stateConnectorAddress
            ? runConfig.stateConnectorAddress :
            (await getStateConnectorAndProofVerifierAddress(runConfig.contractsJsonFile, runConfig.addressUpdater)).scAddress;
        fAssets.push(await createBotFAssetConfig(chainInfo, orm?.em, runConfig.attestationProviderUrls,
            proofVerifierAddress, stateConnectorAddress, ownerAddress, runConfig.walletOptions));
    }
    return {
        rpcUrl: runConfig.rpcUrl,
        loopDelay: runConfig.loopDelay,
        fAssets: fAssets,
        nativeChainInfo: runConfig.nativeChainInfo,
        orm: orm,
        notifiers: standardNotifierTransports(runConfig.alertsUrl),
        addressUpdater: runConfig.addressUpdater,
        contractsJsonFile: runConfig.contractsJsonFile,
        liquidationStrategy: runConfig.liquidationStrategy,
        challengeStrategy: runConfig.challengeStrategy,
    };
}

export function encodedChainId(chainId: string) {
    return chainId.startsWith("0x") ? chainId : encodeAttestationName(chainId);
}

export function decodedChainId(chainId: string) {
    return chainId.startsWith("0x") ? decodeAttestationName(chainId) : chainId;
}

/**
 * Creates BotFAssetConfig configuration from chain info.
 * @param chainInfo instance of BotFAssetInfo
 * @param em entity manager
 * @param attestationProviderUrls list of attestation provider's urls
 * @param scProofVerifierAddress SCProofVerifier's contract address
 * @param stateConnectorAddress  StateConnector's contract address
 * @param ownerAddress native owner address
 * @returns instance of BotFAssetConfig
 */
export async function createBotFAssetConfig(
    chainInfo: BotFAssetInfo,
    em: EM | undefined,
    attestationProviderUrls: string[] | undefined,
    scProofVerifierAddress: string | undefined,
    stateConnectorAddress: string | undefined,
    ownerAddress: string,
    walletOptions?: StuckTransaction
): Promise<BotFAssetConfig> {
    const wallet = chainInfo.walletUrl ? createBlockchainWalletHelper(chainInfo.chainId, em, chainInfo.walletUrl, walletOptions) : undefined;
    const config = await createChainConfig(chainInfo, attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, ownerAddress);
    return {
        ...config,
        wallet: wallet,
    };
}

/**
 * Helper for BotFAssetConfig configuration from chain info.
 * @param chainInfo instance of BotFAssetInfo
 * @param attestationProviderUrls list of attestation provider's urls
 * @param scProofVerifierAddress SCProofVerifier's contract address
 * @param stateConnectorAddress  StateConnector's contract address
 * @param ownerAddress native owner address
 * @returns instance of BotFAssetConfig
 */
export async function createChainConfig(
    chainInfo: BotFAssetInfo,
    attestationProviderUrls: string[] | undefined,
    scProofVerifierAddress: string | undefined,
    stateConnectorAddress: string | undefined,
    ownerAddress: string
): Promise<BotFAssetConfig> {
    const blockchainIndexerClient = chainInfo.indexerUrl
        ? createBlockchainIndexerHelper(chainInfo.chainId, chainInfo.indexerUrl)
        : undefined;
    const stateConnector = stateConnectorAddress && scProofVerifierAddress && attestationProviderUrls && chainInfo.indexerUrl
            ? await createStateConnectorClient(chainInfo.indexerUrl, attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, ownerAddress)
            : undefined;
    const verificationClient = chainInfo.indexerUrl ? await createVerificationApiClient(chainInfo.indexerUrl) : undefined;
    return {
        chainInfo: chainInfo,
        blockchainIndexerClient: blockchainIndexerClient,
        stateConnector: stateConnector,
        verificationClient: verificationClient,
        assetManager: chainInfo.assetManager,
        fAssetSymbol: chainInfo.fAssetSymbol,
        priceChangeEmitter: chainInfo.priceChangeEmitter,
    };
}

export function loadAgentSettings(fname: string) {
    try {
        return agentSettingsLoader.load(fname);
    } catch (error) {
        throw CommandLineError.wrap(error);
    }
}

/**
 * Creates agents initial settings from AgentSettingsConfig, that are needed for agent to be created.
 * @param context fasset agent bot context
 * @param agentSettingsConfigPath path to default agent configuration file
 * @param poolTokenSuffix
 * @returns instance of AgentBotDefaultSettings
 */
export async function createAgentBotDefaultSettings(
    context: IAssetAgentBotContext,
    agentSettings: AgentSettingsConfig
): Promise<AgentBotDefaultSettings> {
    const collateralTypes = await context.assetManager.getCollateralTypes();
    const vaultCollateralToken = collateralTypes.find((token) =>
        Number(token.collateralClass) === CollateralClass.VAULT &&
        token.tokenFtsoSymbol === agentSettings.vaultCollateralFtsoSymbol &&
        toBN(token.validUntil).eqn(0));
    if (!vaultCollateralToken) {
        throw new Error(`Invalid vault collateral token ${agentSettings.vaultCollateralFtsoSymbol}`);
    }
    const agentBotSettings: AgentBotDefaultSettings = {
        vaultCollateralToken: vaultCollateralToken.token,
        poolTokenSuffix: agentSettings.poolTokenSuffix,
        feeBIPS: toBIPS(agentSettings.fee),
        poolFeeShareBIPS: toBIPS(agentSettings.poolFeeShare),
        mintingVaultCollateralRatioBIPS: toBIPS(agentSettings.mintingVaultCollateralRatio),
        mintingPoolCollateralRatioBIPS: toBIPS(agentSettings.mintingPoolCollateralRatio),
        poolExitCollateralRatioBIPS: toBIPS(agentSettings.poolExitCollateralRatio),
        buyFAssetByAgentFactorBIPS: toBIPS(agentSettings.buyFAssetByAgentFactor),
        poolTopupCollateralRatioBIPS: toBIPS(agentSettings.poolTopupCollateralRatio),
        poolTopupTokenPriceFactorBIPS: toBIPS(agentSettings.poolTopupTokenPriceFactor),
    };
    return agentBotSettings;
}

/**
 * Creates wallet client.
 * @param sourceId chain source
 * @param walletUrl chain's url
 * @param inTestnet if testnet should be used, optional parameter
 * @returns instance of Wallet implementation according to sourceId
 */
export function createWalletClient(
    sourceId: SourceId,
    walletUrl: string,
    options?: StuckTransaction
): WALLET.ALGO | WALLET.BTC | WALLET.DOGE | WALLET.LTC | WALLET.XRP {
    if (!supportedSourceId(sourceId)) {
        throw new Error(`SourceId ${sourceId} not supported.`);
    }
    const sOptions = options ? options : {};
    if (sourceId === SourceId.BTC || sourceId === SourceId.testBTC) {
        return new WALLET.BTC({
            url: walletUrl,
            username: "",
            password: "",
            inTestnet: sourceId === SourceId.testBTC ? true : false,
            apiTokenKey: getSecrets().apiKey.btc_rpc,
            stuckTransactionOptions: sOptions,
        }); // UtxoMccCreate
    } else if (sourceId === SourceId.DOGE || sourceId === SourceId.testDOGE) {
        return new WALLET.DOGE({
            url: walletUrl,
            username: "",
            password: "",
            inTestnet: sourceId === SourceId.testDOGE ? true : false,
            apiTokenKey: getSecrets().apiKey.doge_rpc,
            stuckTransactionOptions: sOptions,
        }); // UtxoMccCreate
    } else {
        return new WALLET.XRP({
            url: walletUrl,
            username: "",
            password: "",
            apiTokenKey: getSecrets().apiKey.xrp_rpc,
            inTestnet: sourceId === SourceId.testXRP ? true : false,
            stuckTransactionOptions: sOptions,
        }); // XrpMccCreate
    }
}

/**
 * Creates blockchain indexer helper. Relevant urls and api keys are provided in .env.
 * @param sourceId chain source
 * @param indexerUrl indexer's url
 * @returns instance of BlockchainIndexerHelper
 */
export function createBlockchainIndexerHelper(sourceId: SourceId, indexerUrl: string): BlockchainIndexerHelper {
    if (!supportedSourceId(sourceId)) throw new Error(`SourceId ${sourceId} not supported.`);
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
    if (!supportedSourceId(sourceId)) {
        throw new Error(`SourceId ${sourceId} not supported.`);
    }
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
    if (!supportedSourceId(sourceId)) throw new Error(`SourceId ${sourceId} not supported.`);
    const stateConnector = await createStateConnectorClient(indexerUrl, attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, owner);
    return new AttestationHelper(stateConnector, createBlockchainIndexerHelper(sourceId, indexerUrl), sourceId);
}

/**
 * Creates state connector client
 * @param indexerWebServerUrl indexer's url
 * @param attestationProviderUrls list of attestation provider's urls
 * @param scProofVerifierAddress SCProofVerifier's contract address
 * @param stateConnectorAddress StateConnector's contract address
 * @param owner native owner address
 * @returns instance of StateConnectorClientHelper
 */
export async function createStateConnectorClient(
    indexerWebServerUrl: string,
    attestationProviderUrls: string[],
    scProofVerifierAddress: string,
    stateConnectorAddress: string,
    owner: string
): Promise<StateConnectorClientHelper> {
    const apiKey = requireSecret("apiKey.indexer");
    return await StateConnectorClientHelper.create(attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, indexerWebServerUrl, apiKey, owner);
}

export async function createVerificationApiClient(indexerWebServerUrl: string): Promise<VerificationPrivateApiClient> {
    const apiKey = requireSecret("apiKey.indexer");
    return new VerificationPrivateApiClient(indexerWebServerUrl, apiKey);
}

const supportedSourceIds = [SourceId.XRP, SourceId.BTC, SourceId.DOGE, SourceId.testXRP, SourceId.testBTC, SourceId.testDOGE];

function supportedSourceId(sourceId: SourceId) {
    return supportedSourceIds.includes(sourceId);
}

async function getStateConnectorAndProofVerifierAddress(
    contractsJsonFile?: string,
    addressUpdaterAddress?: string
): Promise<{ pfAddress: string; scAddress: string }> {
    /* istanbul ignore else */ // until 'SCProofVerifier' is defined in explorer
    if (contractsJsonFile) {
        const contracts = loadContracts(contractsJsonFile);
        const pfAddress = requireNotNull(contracts["SCProofVerifier"]?.address, `Cannot find address for SCProofVerifier`);
        const scAddress = requireNotNull(contracts["StateConnector"]?.address, `Cannot find address for StateConnector`);
        return {
            pfAddress,
            scAddress,
        };
    } else if (addressUpdaterAddress) {
        const addressUpdater = await AddressUpdater.at(addressUpdaterAddress);
        const pfAddress = await addressUpdater.getContractAddress("SCProofVerifier");
        const scAddress = await addressUpdater.getContractAddress("StateConnector");
        return {
            pfAddress,
            scAddress,
        };
    }
    throw new Error("Either contractsJsonFile or addressUpdater must be defined");
}

/**
 * At the shutdown of the program, you should close the bot config.
 * This closed DB connections etc.
 */
export async function closeBotConfig(config: BotConfig) {
    await config.orm?.close();
}
