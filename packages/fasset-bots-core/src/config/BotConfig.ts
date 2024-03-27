import "dotenv/config";

import { StuckTransaction, WALLET } from "@flarelabs/simple-wallet";
import { decodeAttestationName, encodeAttestationName } from "@flarenetwork/state-connector-protocol";
import { EntityManager } from "@mikro-orm/core";
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
import { requireNotNull } from "../utils/helpers";
import { NotifierTransport } from "../utils/notifier/BaseNotifier";
import { standardNotifierTransports } from "../utils/notifier/NotifierTransports";
import { artifacts } from "../utils/web3";
import { BotConfigFile, BotFAssetInfo } from "./config-files/BotConfigFile";
import { loadContracts } from "./contracts";
import { EM, ORM } from "./orm";
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
    const wallet = chainInfo.walletUrl
        ? createBlockchainWalletHelper(chainInfo.chainId, em, chainInfo.walletUrl, walletOptions)
        : undefined;
    const blockchainIndexerClient = chainInfo.indexerUrl
        ? createBlockchainIndexerHelper(chainInfo.chainId, chainInfo.indexerUrl)
        : undefined;
    const stateConnector = stateConnectorAddress && scProofVerifierAddress && attestationProviderUrls && chainInfo.indexerUrl
        ? await createStateConnectorClient(chainInfo.indexerUrl, attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, ownerAddress)
        : undefined;
    const verificationClient = chainInfo.indexerUrl
        ? await createVerificationApiClient(chainInfo.indexerUrl)
        : undefined;
    return {
        chainInfo: chainInfo,
        wallet: wallet,
        blockchainIndexerClient: blockchainIndexerClient,
        stateConnector: stateConnector,
        verificationClient: verificationClient,
        assetManager: chainInfo.assetManager,
        fAssetSymbol: chainInfo.fAssetSymbol,
        priceChangeEmitter: chainInfo.priceChangeEmitter,
    };
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
    options: StuckTransaction = {}
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
            stuckTransactionOptions: options,
        }); // UtxoMccCreate
    } else if (sourceId === SourceId.DOGE || sourceId === SourceId.testDOGE) {
        return new WALLET.DOGE({
            url: walletUrl,
            username: "",
            password: "",
            inTestnet: sourceId === SourceId.testDOGE ? true : false,
            apiTokenKey: getSecrets().apiKey.doge_rpc,
            stuckTransactionOptions: options,
        }); // UtxoMccCreate
    } else {
        return new WALLET.XRP({
            url: walletUrl,
            username: "",
            password: "",
            apiTokenKey: getSecrets().apiKey.xrp_rpc,
            inTestnet: sourceId === SourceId.testXRP ? true : false,
            stuckTransactionOptions: options,
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
