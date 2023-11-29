import "dotenv/config";

import { EntityManager } from "@mikro-orm/core/EntityManager";
import { WALLET } from "simple-wallet";
import { AgentBotDefaultSettings, IAssetAgentBotContext } from "../fasset-bots/IAssetBotContext";
import { CollateralClass } from "../fasset/AssetManagerTypes";
import { ChainInfo, NativeChainInfo } from "../fasset/ChainInfo";
import { overrideAndCreateOrm } from "../mikro-orm.config";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { BlockchainIndexerHelper } from "../underlying-chain/BlockchainIndexerHelper";
import { BlockchainWalletHelper } from "../underlying-chain/BlockchainWalletHelper";
import { StateConnectorClientHelper } from "../underlying-chain/StateConnectorClientHelper";
import { IBlockChainWallet } from "../underlying-chain/interfaces/IBlockChainWallet";
import { IStateConnectorClient } from "../underlying-chain/interfaces/IStateConnectorClient";
import { Notifier } from "../utils/Notifier";
import { requireNotNull, toBN } from "../utils/helpers";
import { requireSecret } from "./secrets";
import { CreateOrmOptions, EM, ORM } from "./orm";
import { AgentSettingsConfig, BotConfigFile, BotFAssetInfo } from "./config-files";
import { JsonLoader } from "./json-loader";
import { logger } from "../utils/logger";
import { SourceId } from "../underlying-chain/SourceId";
import { encodeAttestationName } from "@flarenetwork/state-connector-protocol";
import { getSecrets } from "./secrets";
import { loadContracts } from "./contracts";
import { artifacts } from "../utils/web3";
import { DBWalletKeys, MemoryWalletKeys } from "../underlying-chain/WalletKeys";
/* istanbul ignore next */
export { BotConfigFile, BotFAssetInfo, AgentSettingsConfig } from "./config-files";

const AddressUpdater = artifacts.require("AddressUpdater");

export interface BotConfig {
    orm?: ORM; // only for agent bot
    notifier?: Notifier; // only for agent bot
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
    // either one must be set
    assetManager?: string;
    fAssetSymbol?: string;
    // optional settings
    priceChangeEmitter?: string; // the name of the contract (in Contracts file) that emits 'PriceEpochFinalized' event; default is 'FtsoManager'
}

const botConfigLoader = new JsonLoader<BotConfigFile>("run-config/schema/bot-config.schema.json", "bot config JSON");
const agentSettingsLoader = new JsonLoader<AgentSettingsConfig>("run-config/schema/agent-settings.schema.json", "agent settings JSON");

/**
 * Loads configuration file and checks it.
 * @param fPath configuration file path
 * @param configInfo
 * @returns instance BotConfigFile
 */
export function loadConfigFile(fPath: string, configInfo?: string): BotConfigFile {
    try {
        const config = botConfigLoader.load(fPath);
        validateConfigFile(config);
        // check secrets.json file permission
        getSecrets();
        return config;
    } catch (e) {
        /* istanbul ignore next */
        logger.error(configInfo ? `${configInfo}: ${e}` : `${e}`);
        /* istanbul ignore next */
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

export type AgentBotFAssetInfo = BotFAssetInfo & { walletUrl: string };
export type AgentBotConfigFile = BotConfigFile & { defaultAgentSettingsPath: string; ormOptions: CreateOrmOptions; fAssetInfos: AgentBotFAssetInfo[] };

/**
 * Loads agent configuration file and checks it.
 * @param fPath configuration file path
 * @param configInfo
 * @returns instance AgentBotConfigFile
 */
export function loadAgentConfigFile(fPath: string, configInfo?: string): AgentBotConfigFile {
    try {
        const config = botConfigLoader.load(fPath);
        validateAgentConfigFile(config);
        // check secrets.json file permission
        getSecrets();
        return config as AgentBotConfigFile;
    } catch (e) {
        /* istanbul ignore next */
        logger.error(configInfo ? `${configInfo}: ${e}` : `${e}`);
        /* istanbul ignore next */
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
        fAssets.push(
            await createBotFAssetConfig(
                chainInfo,
                orm ? orm.em : undefined,
                runConfig.attestationProviderUrls,
                runConfig.stateConnectorProofVerifierAddress
                    ? runConfig.stateConnectorProofVerifierAddress
                    : (await getStateConnectorAndProofVerifierAddress(runConfig.contractsJsonFile, runConfig.addressUpdater)).pfAddress,
                runConfig.stateConnectorAddress
                    ? runConfig.stateConnectorAddress
                    : (await getStateConnectorAndProofVerifierAddress(runConfig.contractsJsonFile, runConfig.addressUpdater)).scAddress,
                ownerAddress
            )
        );
    }
    return {
        rpcUrl: runConfig.rpcUrl,
        loopDelay: runConfig.loopDelay,
        fAssets: fAssets,
        nativeChainInfo: runConfig.nativeChainInfo,
        orm: orm ? orm : undefined,
        notifier: new Notifier(),
        addressUpdater: runConfig.addressUpdater,
        contractsJsonFile: runConfig.contractsJsonFile,
        liquidationStrategy: runConfig.liquidationStrategy,
        challengeStrategy: runConfig.challengeStrategy,
    };
}

export function encodedChainId(chainId: string) {
    return chainId.startsWith("0x") ? chainId : encodeAttestationName(chainId);
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
    ownerAddress: string
): Promise<BotFAssetConfig> {
    const wallet = chainInfo.walletUrl ? createBlockchainWalletHelper(chainInfo.chainId, em, chainInfo.walletUrl) : undefined;
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
        ? createBlockchainIndexerHelper(chainInfo.chainId, chainInfo.indexerUrl, chainInfo.finalizationBlocks)
        : undefined;
    const stateConnector =
        stateConnectorAddress && scProofVerifierAddress && attestationProviderUrls && chainInfo.indexerUrl
            ? await createStateConnectorClient(chainInfo.indexerUrl, attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, ownerAddress)
            : undefined;
    return {
        chainInfo: chainInfo,
        blockchainIndexerClient: blockchainIndexerClient,
        stateConnector: stateConnector,
        assetManager: chainInfo.assetManager,
        fAssetSymbol: chainInfo.fAssetSymbol,
        priceChangeEmitter: chainInfo.priceChangeEmitter,
    };
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
    agentSettingsConfigPath: string,
    poolTokenSuffix: string
): Promise<AgentBotDefaultSettings> {
    const agentSettingsConfig = agentSettingsLoader.load(agentSettingsConfigPath);
    const vaultCollateralToken = (await context.assetManager.getCollateralTypes()).find((token) => {
        return Number(token.collateralClass) === CollateralClass.VAULT && token.tokenFtsoSymbol === agentSettingsConfig.vaultCollateralFtsoSymbol;
    });
    if (!vaultCollateralToken) {
        throw new Error(`Invalid vault collateral token ${agentSettingsConfig.vaultCollateralFtsoSymbol}`);
    }
    const poolToken = await context.assetManager.getCollateralType(CollateralClass.POOL, await context.assetManager.getWNat());
    const agentBotSettings: AgentBotDefaultSettings = {
        vaultCollateralToken: vaultCollateralToken.token,
        poolTokenSuffix: poolTokenSuffix,
        feeBIPS: toBN(agentSettingsConfig.feeBIPS),
        poolFeeShareBIPS: toBN(agentSettingsConfig.poolFeeShareBIPS),
        mintingVaultCollateralRatioBIPS: toBN(vaultCollateralToken.minCollateralRatioBIPS).muln(agentSettingsConfig.mintingVaultCollateralRatioConstant),
        mintingPoolCollateralRatioBIPS: toBN(poolToken.minCollateralRatioBIPS).muln(agentSettingsConfig.mintingPoolCollateralRatioConstant),
        poolExitCollateralRatioBIPS: toBN(poolToken.minCollateralRatioBIPS).muln(agentSettingsConfig.poolExitCollateralRatioConstant),
        buyFAssetByAgentFactorBIPS: toBN(agentSettingsConfig.buyFAssetByAgentFactorBIPS),
        poolTopupCollateralRatioBIPS: toBN(poolToken.minCollateralRatioBIPS).muln(agentSettingsConfig.poolTopupCollateralRatioConstant),
        poolTopupTokenPriceFactorBIPS: toBN(agentSettingsConfig.poolTopupTokenPriceFactorBIPS),
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
    walletUrl: string
): WALLET.ALGO | WALLET.BTC | WALLET.DOGE | WALLET.LTC | WALLET.XRP {
    if (!supportedSourceId(sourceId)) {
        throw new Error(`SourceId ${sourceId} not supported.`);
    }
    if (sourceId === SourceId.BTC || sourceId === SourceId.testBTC) {
        return new WALLET.BTC({
            url: walletUrl,
            username: "",
            password: "",
            inTestnet: sourceId === SourceId.testBTC ? true : false,
            apiTokenKey: getSecrets().apiKey.btc_rpc,
        }); // UtxoMccCreate
    } else if (sourceId === SourceId.DOGE || sourceId === SourceId.testDOGE) {
        return new WALLET.DOGE({
            url: walletUrl,
            username: "",
            password: "",
            inTestnet: sourceId === SourceId.testDOGE ? true : false,
            apiTokenKey: getSecrets().apiKey.doge_rpc,
        }); // UtxoMccCreate
    } else {
        return new WALLET.XRP({
            url: walletUrl,
            username: "",
            password: "",
            apiTokenKey: getSecrets().apiKey.xrp_rpc,
            inTestnet: sourceId === SourceId.testXRP ? true : false,
        }); // XrpMccCreate
    }
}

/**
 * Creates blockchain indexer helper. Relevant urls and api keys are provided in .env.
 * @param sourceId chain source
 * @param indexerUrl indexer's url
 * @param finalizationBlocks number of blocks after which transaction is considered confirmed
 * @returns instance of BlockchainIndexerHelper
 */
export function createBlockchainIndexerHelper(sourceId: SourceId, indexerUrl: string, finalizationBlocks: number): BlockchainIndexerHelper {
    if (!supportedSourceId(sourceId)) throw new Error(`SourceId ${sourceId} not supported.`);
    const apiKey = requireSecret("apiKey.indexer");
    return new BlockchainIndexerHelper(indexerUrl, sourceId, finalizationBlocks, apiKey);
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
    walletUrl: string
): BlockchainWalletHelper {
    if (!supportedSourceId(sourceId)) {
        throw new Error(`SourceId ${sourceId} not supported.`);
    }
    const walletClient = createWalletClient(sourceId, walletUrl);
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
 * @param finalizationBlocks number of blocks after which transaction is considered confirmed
 * @returns instance of AttestationHelper
 */
export async function createAttestationHelper(
    sourceId: SourceId,
    attestationProviderUrls: string[],
    scProofVerifierAddress: string,
    stateConnectorAddress: string,
    owner: string,
    indexerUrl: string,
    finalizationBlocks: number
): Promise<AttestationHelper> {
    if (!supportedSourceId(sourceId)) throw new Error(`SourceId ${sourceId} not supported.`);
    const stateConnector = await createStateConnectorClient(indexerUrl, attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, owner);
    return new AttestationHelper(stateConnector, createBlockchainIndexerHelper(sourceId, indexerUrl, finalizationBlocks), sourceId);
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
