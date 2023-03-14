import { AlgoMccCreate, MCC, UtxoMccCreate, XrpMccCreate } from "@flarenetwork/mcc";
import { Connection } from "@mikro-orm/core/connections/Connection";
import { IDatabaseDriver } from "@mikro-orm/core/drivers/IDatabaseDriver";
import { EntityManager } from "@mikro-orm/core/EntityManager";
import { WALLET } from "simple-wallet";
import { ChainInfo, NativeChainInfo } from "../fasset/ChainInfo";
import { overrideAndCreateOrm } from "../mikro-orm.config";
import { Notifier } from "../utils/Notifier";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { BlockChainHelper } from "../underlying-chain/BlockChainHelper";
import { BlockChainIndexerHelper } from "../underlying-chain/BlockChainIndexerHelper";
import { BlockChainWalletHelper } from "../underlying-chain/BlockChainWalletHelper";
import { IBlockChain } from "../underlying-chain/interfaces/IBlockChain";
import { IBlockChainWallet } from "../underlying-chain/interfaces/IBlockChainWallet";
import { IStateConnectorClient } from "../underlying-chain/interfaces/IStateConnectorClient";
import { StateConnectorClientHelper } from "../underlying-chain/StateConnectorClientHelper";
import { artifacts } from "../utils/artifacts";
import { requireEnv } from "../utils/helpers";
import { SourceId } from "../verification/sources/sources";
import { CreateOrmOptions, EM, ORM } from "./orm";

export interface RunConfig {
    rpcUrl: string,
    loopDelay: number;
    nativeChainInfo: NativeChainInfo;
    chainInfos: BotChainInfo[];
    ormOptions: CreateOrmOptions;
    attestationProviderUrls: string[];
    attestationClientAddress: string;
    stateConnectorAddress: string;
    // notifierFile: string;
    // either one must be set
    addressUpdater?: string;
    contractsJsonFile?: string;
}

export interface BotConfig {
    rpcUrl: string;
    loopDelay: number;
    stateConnector: IStateConnectorClient;
    chains: BotConfigChain[];
    nativeChainInfo: NativeChainInfo;
    orm: ORM;
    notifier: Notifier;
    // either one must be set
    addressUpdater?: string;
    contractsJsonFile?: string;
}

export interface BotConfigChain {
    chainInfo: ChainInfo;
    chain: IBlockChain;
    wallet: IBlockChainWallet;
    blockChainIndexerClient: BlockChainIndexerHelper;
    // either one must be set
    assetManager?: string;
    fAssetSymbol?: string;
}

export interface BotChainInfo extends ChainInfo {
    inTestnet?: boolean;
    // either one must be set
    assetManager?: string;
    fAssetSymbol?: string;
}

export async function createBotConfig(runConfig: RunConfig, ownerAddress: string): Promise<BotConfig> {
    const stateConnector = await createStateConnectorClient(runConfig.attestationProviderUrls, runConfig.attestationClientAddress, runConfig.stateConnectorAddress, ownerAddress);
    const orm = await overrideAndCreateOrm(runConfig.ormOptions);
    const chains: BotConfigChain[] = [];
    for (const chainInfo of runConfig.chainInfos) {
        chains.push(await createBotConfigChain(chainInfo, orm.em));
    }
    return {
        rpcUrl: runConfig.rpcUrl,
        loopDelay: runConfig.loopDelay,
        stateConnector: stateConnector,
        chains: chains,
        nativeChainInfo: runConfig.nativeChainInfo,
        orm: orm,
        notifier: new Notifier(),
        addressUpdater: runConfig.addressUpdater,
        contractsJsonFile: runConfig.contractsJsonFile
    };
}

export async function createBotConfigChain(chainInfo: BotChainInfo, em: EM): Promise<BotConfigChain> {
    const chain = createBlockChainHelper(chainInfo.chainId);
    const wallet = createBlockChainWalletHelper(chainInfo.chainId, em, chainInfo.inTestnet);
    const blockChainIndexerClient = createBlockChainIndexerHelper(chainInfo.chainId, chainInfo.inTestnet);
    return {
        chainInfo: chainInfo,
        chain: chain,
        wallet: wallet,
        blockChainIndexerClient: blockChainIndexerClient,
        assetManager: chainInfo.assetManager,
        fAssetSymbol: chainInfo.fAssetSymbol
    };
}

export function createWalletClient(sourceId: SourceId, inTestnet?: boolean): WALLET.ALGO | WALLET.BTC | WALLET.DOGE | WALLET.LTC | WALLET.XRP {
    switch (sourceId) {
        case SourceId.ALGO:
            return new WALLET.ALGO({
                algod: {
                    url: requireEnv('ALGO_ALGOD_URL_WALLET'),
                    token: ""
                },
                apiTokenKey: process.env.FLARE_API_PORTAL_KEY || ""
            } as AlgoMccCreate);
        case SourceId.BTC:
            return new WALLET.BTC({
                url: requireEnv('BTC_URL_WALLET'),
                username: "",
                password: "",
                inTestnet: inTestnet
            } as UtxoMccCreate);
        case SourceId.DOGE:
            return new WALLET.DOGE({
                url: requireEnv('DOGE_URL_WALLET'),
                username: "",
                password: "",
                inTestnet: inTestnet
            } as UtxoMccCreate);
        case SourceId.LTC:
            return new WALLET.LTC({
                url: requireEnv('LTC_URL_WALLET'),
                username: "",
                password: "",
                inTestnet: inTestnet
            } as UtxoMccCreate);
        case SourceId.XRP:
            return new WALLET.XRP({
                url: requireEnv('XRP_URL_WALLET'),
                username: "",
                password: "",
                apiTokenKey: process.env.FLARE_API_PORTAL_KEY || ""
            } as XrpMccCreate);
        default:
            throw new Error(`SourceId ${sourceId} not supported.`);
    }
}

export function createMccClient(sourceId: SourceId): MCC.ALGO | MCC.BTC | MCC.DOGE | MCC.LTC | MCC.XRP {
    switch (sourceId) {
        case SourceId.ALGO:
            return new MCC.ALGO({
                algod: {
                    url: requireEnv('ALGO_ALGOD_URL_MCC'),
                    token: "",
                },
                indexer: {
                    url: requireEnv('ALGO_INDEXER_URL_MCC'),
                    token: "",
                },
                apiTokenKey: process.env.FLARE_API_PORTAL_KEY || ""
            } as AlgoMccCreate);
        case SourceId.BTC:
            return new MCC.BTC({
                url: requireEnv('BTC_URL_MCC'),
                username: process.env.BTC_USERNAME_MCC || "",
                password: process.env.BTC_PASSWORD_MCC || "",
                apiTokenKey: process.env.FLARE_API_PORTAL_KEY || ""
            } as UtxoMccCreate);
        case SourceId.DOGE:
            return new MCC.DOGE({
                url: requireEnv('DOGE_URL_MCC'),
                username: process.env.DOGE_USERNAME_MCC || "",
                password: process.env.DOGE_PASSWORD_MCC || "",
                apiTokenKey: process.env.FLARE_API_PORTAL_KEY || ""
            } as UtxoMccCreate);
        case SourceId.LTC:
            return new MCC.LTC({
                url: requireEnv('LTC_URL_MCC'),
                username: process.env.LTC_USERNAME_MCC || "",
                password: process.env.LTC_PASSWORD_MCC || "",
                apiTokenKey: process.env.FLARE_API_PORTAL_KEY || ""
            } as UtxoMccCreate);
        case SourceId.XRP:
            return new MCC.XRP({
                url: requireEnv('XRP_URL_MCC'),
                username: process.env.XRP_USERNAME_MCC || "",
                password: process.env.XRP_PASSWORD_MCC || "",
                apiTokenKey: process.env.FLARE_API_PORTAL_KEY || ""
            } as XrpMccCreate);
        default:
            throw new Error(`SourceId ${sourceId} not supported.`);
    }
}

export function createBlockChainIndexerHelper(sourceId: SourceId, inTestnet?: boolean): BlockChainIndexerHelper {
    const indexerWebServerUrl: string = requireEnv('INDEXER_WEB_SERVER_URL');
    switch (sourceId) {
        case SourceId.ALGO:
            return new BlockChainIndexerHelper(indexerWebServerUrl, sourceId, createWalletClient(sourceId));
        case SourceId.BTC:
            return new BlockChainIndexerHelper(indexerWebServerUrl, sourceId, createWalletClient(sourceId, inTestnet));
        case SourceId.DOGE:
            return new BlockChainIndexerHelper(indexerWebServerUrl, sourceId, createWalletClient(sourceId, inTestnet));
        case SourceId.LTC:
            return new BlockChainIndexerHelper(indexerWebServerUrl, sourceId, createWalletClient(sourceId, inTestnet));
        case SourceId.XRP:
            return new BlockChainIndexerHelper(indexerWebServerUrl, sourceId, createWalletClient(sourceId));
        default:
            throw new Error(`SourceId ${sourceId} not supported.`);
    }
}

export function createBlockChainHelper(sourceId: SourceId, inTestnet?: boolean): BlockChainHelper {
    switch (sourceId) {
        case SourceId.ALGO:
            return new BlockChainHelper(createWalletClient(sourceId), createMccClient(sourceId));
        case SourceId.BTC:
            return new BlockChainHelper(createWalletClient(sourceId, inTestnet), createMccClient(sourceId));
        case SourceId.DOGE:
            return new BlockChainHelper(createWalletClient(sourceId, inTestnet), createMccClient(sourceId));
        case SourceId.LTC:
            return new BlockChainHelper(createWalletClient(sourceId, inTestnet), createMccClient(sourceId));
        case SourceId.XRP:
            return new BlockChainHelper(createWalletClient(sourceId), createMccClient(sourceId));
        default:
            throw new Error(`SourceId ${sourceId} not supported.`);
    }
}

export function createBlockChainWalletHelper(sourceId: SourceId, em: EntityManager<IDatabaseDriver<Connection>>, inTestnet?: boolean): BlockChainWalletHelper {
    switch (sourceId) {
        case SourceId.ALGO:
            return new BlockChainWalletHelper(createWalletClient(sourceId), em, createBlockChainHelper(sourceId));
        case SourceId.BTC:
            return new BlockChainWalletHelper(createWalletClient(sourceId, inTestnet), em, createBlockChainHelper(sourceId));
        case SourceId.DOGE:
            return new BlockChainWalletHelper(createWalletClient(sourceId, inTestnet), em, createBlockChainHelper(sourceId));
        case SourceId.LTC:
            return new BlockChainWalletHelper(createWalletClient(sourceId, inTestnet), em, createBlockChainHelper(sourceId));
        case SourceId.XRP:
            return new BlockChainWalletHelper(createWalletClient(sourceId), em, createBlockChainHelper(sourceId));
        default:
            throw new Error(`SourceId ${sourceId} not supported.`);
    }
}

export async function createAttestationHelper(sourceId: SourceId, stateConnector: StateConnectorClientHelper, inTestnet?: boolean): Promise<AttestationHelper> {
    switch (sourceId) {
        case SourceId.ALGO:
            return new AttestationHelper(stateConnector, createBlockChainHelper(sourceId), sourceId);
        case SourceId.BTC:
            return new AttestationHelper(stateConnector, createBlockChainHelper(sourceId, inTestnet), sourceId);
        case SourceId.DOGE:
            return new AttestationHelper(stateConnector, createBlockChainHelper(sourceId, inTestnet), sourceId);
        case SourceId.LTC:
            return new AttestationHelper(stateConnector, createBlockChainHelper(sourceId, inTestnet), sourceId);
        case SourceId.XRP:
            return new AttestationHelper(stateConnector, createBlockChainHelper(sourceId), sourceId);
        default:
            throw new Error(`SourceId ${sourceId} not supported.`);
    }
}

export async function createStateConnectorClient(attestationProviderUrls: string[], attestationClientAddress: string, stateConnectorAddress: string, owner: string): Promise<StateConnectorClientHelper> {
    return await StateConnectorClientHelper.create(artifacts, attestationProviderUrls, attestationClientAddress, stateConnectorAddress, owner);
}