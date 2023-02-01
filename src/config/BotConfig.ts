import { MCC, UtxoMccCreate, XrpMccCreate } from "@flarenetwork/mcc";
import { Connection } from "@mikro-orm/core/connections/Connection";
import { IDatabaseDriver } from "@mikro-orm/core/drivers/IDatabaseDriver";
import { EntityManager } from "@mikro-orm/core/EntityManager";
import { WALLET } from "simple-wallet";
import { ChainInfo, NativeChainInfo } from "../fasset/ChainInfo";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { BlockChainHelper } from "../underlying-chain/BlockChainHelper";
import { BlockChainIndexerHelper } from "../underlying-chain/BlockChainIndexerHelper";
import { BlockChainWalletHelper } from "../underlying-chain/BlockChainWalletHelper";
import { IBlockChain } from "../underlying-chain/interfaces/IBlockChain";
import { IBlockChainEvents } from "../underlying-chain/interfaces/IBlockChainEvents";
import { IBlockChainWallet } from "../underlying-chain/interfaces/IBlockChainWallet";
import { IStateConnectorClient } from "../underlying-chain/interfaces/IStateConnectorClient";
import { StateConnectorClientHelper } from "../underlying-chain/StateConnectorClientHelper";
import { artifacts } from "../utils/artifacts";
import { requireEnv } from "../utils/helpers";
import { SourceId } from "../verification/sources/sources";

export interface BotConfigChain {
    chainInfo: ChainInfo;
    chain: IBlockChain;
    chainEvents: IBlockChainEvents,
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
}

export function createWalletClient(sourceId: SourceId) {
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

export function createMccClient(sourceId: SourceId) {
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

export function createIndexerHelper(sourceId: SourceId) {
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

export function createBlockChainHelper(sourceId: SourceId) {
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

export function createBlockChainWalletHelper(sourceId: SourceId, em: EntityManager<IDatabaseDriver<Connection>>) {
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

export async function createAttestationHelper(sourceId: SourceId) {
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

export async function createStateConnectorClient() {
    const attestationProviderUrls: string[] = requireEnv('ATTESTER_BASE_URLS').split(",");;
    const attestationClientAddress: string = requireEnv('ATTESTATION_CLIENT_ADDRESS');
    const stateConnectorAddress: string = requireEnv('STATE_CONNECTOR_ADDRESS');
    const account = requireEnv('OWNER_ADDRESS');
    return await StateConnectorClientHelper.create(artifacts, attestationProviderUrls, attestationClientAddress, stateConnectorAddress, account);
}