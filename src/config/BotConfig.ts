import { MCC, UtxoMccCreate, XrpMccCreate } from "@flarenetwork/mcc";
import { Connection } from "@mikro-orm/core/connections/Connection";
import { IDatabaseDriver } from "@mikro-orm/core/drivers/IDatabaseDriver";
import { EntityManager } from "@mikro-orm/core/EntityManager";
import { WALLET } from "simple-wallet";
import { ChainInfo, NativeChainInfo } from "../fasset/ChainInfo";
import options from "../mikro-orm.config";
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
import { createOrm, CreateOrmOptions, EM, ORM } from "./orm";

export interface RunConfig {
    loopDelay: number;
    // either one must be set
    addressUpdater?: string;
    contractsJsonFile?: string;
    nativeChainInfo: NativeChainInfo;
    chainInfos: ChainInfo[];
    ormOptions: CreateOrmOptions;
}

export interface BotConfigChain {
    chainInfo: ChainInfo;
    chain: IBlockChain;
    wallet: IBlockChainWallet;
    assetManager?: string;
    fAssetSymbol?: string;
    blockChainIndexerClient: BlockChainIndexerHelper;
}

export interface BotConfig {
    rpcUrl: string;
    loopDelay: number;
    // either one must be set
    addressUpdater?: string;
    contractsJsonFile?: string;
    stateConnector: IStateConnectorClient;
    chains: BotConfigChain[];
    nativeChainInfo: NativeChainInfo;
    orm: ORM;
}

export async function createBotConfig(runConfig: RunConfig): Promise<BotConfig> {
    const stateConnector = await createStateConnectorClient();
    const orm = await createOrm({ ...options, schemaUpdate: 'safe' });
    const chains: BotConfigChain[] = [];
    for (let chainInfo of runConfig.chainInfos) {
        chains.push(await createBotConfigChain(chainInfo, orm.em))
    }
    return {
        rpcUrl: requireEnv('RPC_URL'),
        loopDelay: runConfig.loopDelay,
        addressUpdater: runConfig.addressUpdater,
        contractsJsonFile: runConfig.contractsJsonFile,
        stateConnector: stateConnector,
        chains: chains,
        nativeChainInfo: runConfig.nativeChainInfo,
        orm: orm
    }
}

export async function createBotConfigChain(chainInfo: ChainInfo, em: EM): Promise<BotConfigChain> {
    const chain = createBlockChainHelper(chainInfo.chainId);
    const wallet = createBlockChainWalletHelper(chainInfo.chainId, em);
    const blockChainIndexerClient =  createBlockChainIndexerHelper(chainInfo.chainId);
    return {
        chainInfo: chainInfo,
        chain: chain,
        wallet: wallet,
        blockChainIndexerClient: blockChainIndexerClient
    }
}

export function createWalletClient(sourceId: SourceId): WALLET.ALGO | WALLET.BTC | WALLET.DOGE | WALLET.LTC | WALLET.XRP {
    switch (sourceId) {
        case SourceId.ALGO:
            return new WALLET.ALGO({
                algod: {
                    url: requireEnv('ALGO_ALGOD_URL_WALLET'),
                    token: ""
                },
            })
        case SourceId.BTC:
            return new WALLET.BTC({
                url: requireEnv('BTC_LTC_DOGE_URL_WALLET'),
                username: "",
                password: "",
                inTestnet: true
            } as UtxoMccCreate);
        case SourceId.DOGE:
            return new WALLET.DOGE({
                url: requireEnv('BTC_LTC_DOGE_URL_WALLET'),
                username: "",
                password: "",
                inTestnet: true
            } as UtxoMccCreate);
        case SourceId.LTC:
            return new WALLET.LTC({
                url: requireEnv('BTC_LTC_DOGE_URL_WALLET'),
                username: "",
                password: "",
                inTestnet: true
            } as UtxoMccCreate);
        case SourceId.XRP:
            return new WALLET.XRP({
                url: requireEnv('XRP_URL_WALLET'),
                username: "",
                password: "",
                inTestnet: true
            } as XrpMccCreate)
        default:
            throw new Error(`SourceId ${sourceId} not supported.`)
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
            })
        case SourceId.BTC:
            return new MCC.BTC({
                url: requireEnv('BTC_URL_MCC'),
                username: requireEnv('BTC_USERNAME_MCC'),
                password: requireEnv('BTC_PASSWORD_MCC'),
                inTestnet: true
            } as UtxoMccCreate);
        case SourceId.DOGE:
            return new MCC.DOGE({
                url: requireEnv('DOGE_URL_MCC'),
                username: requireEnv('DOGE_USERNAME_MCC'),
                password: requireEnv('DOGE_PASSWORD_MCC'),
                inTestnet: true
            } as UtxoMccCreate);
        case SourceId.LTC:
            return new MCC.LTC({
                url: requireEnv('LTC_URL_MCC'),
                username: requireEnv('LTC_USERNAME_MCC'),
                password: requireEnv('LTC_PASSWORD_MCC'),
                inTestnet: true
            } as UtxoMccCreate);
        case SourceId.XRP:
            return new MCC.XRP({
                url: requireEnv('XRP_URL_MCC'),
                username: "",
                password: "",
                inTestnet: true
            } as XrpMccCreate)
        default:
            throw new Error(`SourceId ${sourceId} not supported.`)
    }
}

export function createBlockChainIndexerHelper(sourceId: SourceId): BlockChainIndexerHelper {
    const indexerWebServerUrl: string = requireEnv('INDEXER_WEB_SERVER_URL');
    switch (sourceId) {
        case SourceId.ALGO:
            return new BlockChainIndexerHelper(indexerWebServerUrl, sourceId, createWalletClient(sourceId));
        case SourceId.BTC:
            return new BlockChainIndexerHelper(indexerWebServerUrl, sourceId, createWalletClient(sourceId));
        case SourceId.DOGE:
            return new BlockChainIndexerHelper(indexerWebServerUrl, sourceId, createWalletClient(sourceId));
        case SourceId.LTC:
            return new BlockChainIndexerHelper(indexerWebServerUrl, sourceId, createWalletClient(sourceId));
        case SourceId.XRP:
            return new BlockChainIndexerHelper(indexerWebServerUrl, sourceId, createWalletClient(sourceId));
        default:
            throw new Error(`SourceId not supported ${sourceId}`)
    }
}

export function createBlockChainHelper(sourceId: SourceId): BlockChainHelper {
    switch (sourceId) {
        case SourceId.ALGO:
            return new BlockChainHelper(createWalletClient(sourceId), createMccClient(sourceId));
        case SourceId.BTC:
            return new BlockChainHelper(createWalletClient(sourceId), createMccClient(sourceId));
        case SourceId.DOGE:
            return new BlockChainHelper(createWalletClient(sourceId), createMccClient(sourceId));
        case SourceId.LTC:
            return new BlockChainHelper(createWalletClient(sourceId), createMccClient(sourceId));
        case SourceId.XRP:
            return new BlockChainHelper(createWalletClient(sourceId), createMccClient(sourceId));
        default:
            throw new Error(`SourceId not supported ${sourceId}`)
    }
}

export function createBlockChainWalletHelper(sourceId: SourceId, em: EntityManager<IDatabaseDriver<Connection>>): BlockChainWalletHelper {
    switch (sourceId) {
        case SourceId.ALGO:
            return new BlockChainWalletHelper(createWalletClient(sourceId), em, createBlockChainHelper(sourceId));
        case SourceId.BTC:
            return new BlockChainWalletHelper(createWalletClient(sourceId), em, createBlockChainHelper(sourceId));
        case SourceId.DOGE:
            return new BlockChainWalletHelper(createWalletClient(sourceId), em, createBlockChainHelper(sourceId));
        case SourceId.LTC:
            return new BlockChainWalletHelper(createWalletClient(sourceId), em, createBlockChainHelper(sourceId));
        case SourceId.XRP:
            return new BlockChainWalletHelper(createWalletClient(sourceId), em, createBlockChainHelper(sourceId));
        default:
            throw new Error(`SourceId ${sourceId} not supported.`)
    }
}

export async function createAttestationHelper(sourceId: SourceId): Promise<AttestationHelper> {
    switch (sourceId) {
        case SourceId.ALGO:
            return new AttestationHelper(await createStateConnectorClient(), createBlockChainHelper(sourceId), sourceId);
        case SourceId.BTC:
            return new AttestationHelper(await createStateConnectorClient(), createBlockChainHelper(sourceId), sourceId);
        case SourceId.DOGE:
            return new AttestationHelper(await createStateConnectorClient(), createBlockChainHelper(sourceId), sourceId);
        case SourceId.LTC:
            return new AttestationHelper(await createStateConnectorClient(), createBlockChainHelper(sourceId), sourceId);
        case SourceId.XRP:
            return new AttestationHelper(await createStateConnectorClient(), createBlockChainHelper(sourceId), sourceId);
        default:
            throw new Error(`SourceId ${sourceId} not supported.`)
    }
}

export async function createStateConnectorClient(): Promise<StateConnectorClientHelper> {
    const attestationProviderUrls: string[] = requireEnv('ATTESTER_BASE_URLS').split(",");
    const attestationClientAddress: string = requireEnv('ATTESTATION_CLIENT_ADDRESS');
    const stateConnectorAddress: string = requireEnv('STATE_CONNECTOR_ADDRESS');
    const account = requireEnv('OWNER_ADDRESS');
    return await StateConnectorClientHelper.create(artifacts, attestationProviderUrls, attestationClientAddress, stateConnectorAddress, account);
}