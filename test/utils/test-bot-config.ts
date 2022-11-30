import { MCC, UtxoMccCreate, XrpMccCreate } from "@flarenetwork/mcc";
import { Connection, EntityManager, IDatabaseDriver } from "@mikro-orm/core";
import { WALLET } from "simple-wallet";
import { BotConfig, BotConfigChain } from "../../src/config/BotConfig";
import { loadContracts } from "../../src/config/contracts";
import { EM } from "../../src/config/orm";
import { MockChain, MockChainWallet } from "../../src/mock/MockChain";
import { MockStateConnectorClient } from "../../src/mock/MockStateConnectorClient";
import { AttestationHelper } from "../../src/underlying-chain/AttestationHelper";
import { BlockChainHelper } from "../../src/underlying-chain/BlockChainHelper";
import { BlockChainIndexerHelper } from "../../src/underlying-chain/BlockChainIndexerHelper";
import { BlockChainWalletHelper } from "../../src/underlying-chain/BlockChainWalletHelper";
import { StateConnectorClientHelper } from "../../src/underlying-chain/StateConnectorClientHelper";
import { artifacts } from "../../src/utils/artifacts";
import { requireEnv } from "../../src/utils/helpers";
import { SourceId } from "../../src/verification/sources/sources";
import { testChainInfo, TestChainInfo } from "./TestChainInfo";

const LOCAL_HARDHAT_RPC = "http://127.0.0.1:8545";
const CONTRACTS_JSON = "../fasset/deployment/deploys/hardhat.json";
const indexerWebServerUrl: string = requireEnv('INDEXER_WEB_SERVER_URL');

const StateConnectorMock = artifacts.require("StateConnectorMock");

export async function createTestConfig(chains: string[] = ['btc', 'xrp']): Promise<BotConfig> {
    const contracts = loadContracts(CONTRACTS_JSON);
    const stateConnectorMock = await StateConnectorMock.at(contracts.StateConnector.address);
    const stateConnectorClient = new MockStateConnectorClient(stateConnectorMock, 'auto');
    const chainConfigs: BotConfigChain[] = [];
    if (chains.includes('btc')) {
        chainConfigs.push(createMockChainConfig('FBTC', testChainInfo.btc, stateConnectorClient));
    }
    if (chains.includes('xrp')) {
        chainConfigs.push(createMockChainConfig('FXRP', testChainInfo.xrp, stateConnectorClient));
    }
    return {
        rpcUrl: LOCAL_HARDHAT_RPC,
        loopDelay: 0,
        contractsJsonFile: CONTRACTS_JSON,
        stateConnector: stateConnectorClient,
        chains: chainConfigs,
        nativeChainInfo: {
            finalizationBlocks: 0,
            readLogsChunkSize: 10,
        }
    }
}

function createMockChainConfig(fAssetSymbol: string, info: TestChainInfo, stateConnectorClient: MockStateConnectorClient): BotConfigChain {
    const chain = new MockChain();
    chain.finalizationBlocks = info.finalizationBlocks;
    chain.secondsPerBlock = info.blockTime;
    stateConnectorClient.addChain(info.chainId, chain);
    return {
        chain: chain,
        chainEvents: chain,
        chainInfo: info,
        wallet: new MockChainWallet(chain),
        fAssetSymbol: fAssetSymbol,
        blockChainIndexerClient: createTestIndexerHelper(info.chainId)
    };
}

export async function createTestConfigNoMocks(chains: string[] = ['btc', 'xrp'], em: EM): Promise<BotConfig> {
    const stateConnectorClient = await createTestStateConnectorClient();
    const chainConfigs: BotConfigChain[] = [];
    if (chains.includes('btc')) {
        chainConfigs.push(createChainConfig('FBTC', testChainInfo.btc, em));
    }
    if (chains.includes('xrp')) {
        chainConfigs.push(createChainConfig('FXRP', testChainInfo.xrp, em));
    }
    return {
        rpcUrl: LOCAL_HARDHAT_RPC,
        loopDelay: 0,
        contractsJsonFile: CONTRACTS_JSON,
        stateConnector: stateConnectorClient,
        chains: chainConfigs,
        nativeChainInfo: {
            finalizationBlocks: 0,
            readLogsChunkSize: 10,
        }
    }
}

function createChainConfig(fAssetSymbol: string, info: TestChainInfo, em: EM): BotConfigChain {
    const chainEv = new MockChain(); // OK one mock here, but it is not really used
    const chain = createTestBlockChainHelper(info.chainId);
    chain.finalizationBlocks = info.finalizationBlocks;
    chain.secondsPerBlock = info.blockTime;
    const wallet = createTestBlockChainWalletHelper(info.chainId, em);
    const indexer = createTestIndexerHelper(info.chainId);
    return {
        chain: chain,
        chainEvents: chainEv,
        chainInfo: info,
        wallet: wallet,
        fAssetSymbol: fAssetSymbol,
        blockChainIndexerClient: indexer
    };

}

export function createTestWalletClient(sourceId: SourceId) {
    switch (sourceId) {
        case SourceId.ALGO:
            return new WALLET.ALGO({
                algod: {
                    url: requireEnv('ALGO_ALGOD_URL_TESTNET_WALLET'),
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
                url: requireEnv('XRP_URL_TESTNET_WALLET'),
                username: "",
                password: "",
                inTestnet: true
            } as XrpMccCreate)
        default:
            throw new Error(`SourceId not supported ${sourceId}`)
    }
}

export function createTestMccClient(sourceId: SourceId) {
    switch (sourceId) {
        case SourceId.ALGO:
            return new MCC.ALGO({
                algod: {
                    url: requireEnv('ALGO_ALGOD_URL_TESTNET_MCC'),
                    token: "",
                },
                indexer: {
                    url: requireEnv('ALGO_INDEXER_URL_TESTNET_MCC'),
                    token: "",
                },
            })
        case SourceId.BTC:
            return new MCC.BTC({
                url: requireEnv('BTC_URL_TESTNET_MCC'),
                username: requireEnv('BTC_USERNAME_TESTNET_MCC'),
                password: requireEnv('BTC_PASSWORD_TESTNET_MCC'),
                inTestnet: true
            } as UtxoMccCreate);
        case SourceId.DOGE:
            return new MCC.DOGE({
                url: requireEnv('DOGE_URL_TESTNET_MCC'),
                username: requireEnv('DOGE_USERNAME_TESTNET_MCC'),
                password: requireEnv('DOGE_PASSWORD_TESTNET_MCC'),
                inTestnet: true
            } as UtxoMccCreate);
        case SourceId.LTC:
            return new MCC.LTC({
                url: requireEnv('LTC_URL_TESTNET_MCC'),
                username: requireEnv('LTC_USERNAME_TESTNET_MCC'),
                password: requireEnv('LTC_PASSWORD_TESTNET_MCC'),
                inTestnet: true
            } as UtxoMccCreate);
        case SourceId.XRP:
            return new MCC.XRP({
                url: requireEnv('XRP_URL_TESTNET_MCC'),
                username: "",
                password: "",
                inTestnet: true
            } as XrpMccCreate)
        default:
            throw new Error(`SourceId not supported ${sourceId}`)
    }
}

export function createTestIndexerHelper(sourceId: SourceId) {
    switch (sourceId) {
        case SourceId.ALGO:
            return new BlockChainIndexerHelper(indexerWebServerUrl, sourceId, createTestWalletClient(sourceId));
        case SourceId.BTC:
            return new BlockChainIndexerHelper(indexerWebServerUrl, sourceId, createTestWalletClient(sourceId));
        case SourceId.DOGE:
            return new BlockChainIndexerHelper(indexerWebServerUrl, sourceId, createTestWalletClient(sourceId));
        case SourceId.LTC:
            return new BlockChainIndexerHelper(indexerWebServerUrl, sourceId, createTestWalletClient(sourceId));
        case SourceId.XRP:
            return new BlockChainIndexerHelper(indexerWebServerUrl, sourceId, createTestWalletClient(sourceId));
        default:
            throw new Error(`SourceId not supported ${sourceId}`)
    }
}

export function createTestBlockChainHelper(sourceId: SourceId) {
    switch (sourceId) {
        case SourceId.ALGO:
            return new BlockChainHelper(createTestWalletClient(sourceId), createTestMccClient(sourceId));
        case SourceId.BTC:
            return new BlockChainHelper(createTestWalletClient(sourceId), createTestMccClient(sourceId));
        case SourceId.DOGE:
            return new BlockChainHelper(createTestWalletClient(sourceId), createTestMccClient(sourceId));
        case SourceId.LTC:
            return new BlockChainHelper(createTestWalletClient(sourceId), createTestMccClient(sourceId));
        case SourceId.XRP:
            return new BlockChainHelper(createTestWalletClient(sourceId), createTestMccClient(sourceId));
        default:
            throw new Error(`SourceId not supported ${sourceId}`)
    }
}

export function createTestBlockChainWalletHelper(sourceId: SourceId, em: EntityManager<IDatabaseDriver<Connection>>) {
    switch (sourceId) {
        case SourceId.ALGO:
            return new BlockChainWalletHelper(createTestWalletClient(sourceId), em, createTestBlockChainHelper(sourceId));
        case SourceId.BTC:
            return new BlockChainWalletHelper(createTestWalletClient(sourceId), em, createTestBlockChainHelper(sourceId));
        case SourceId.DOGE:
            return new BlockChainWalletHelper(createTestWalletClient(sourceId), em, createTestBlockChainHelper(sourceId));
        case SourceId.LTC:
            return new BlockChainWalletHelper(createTestWalletClient(sourceId), em, createTestBlockChainHelper(sourceId));
        case SourceId.XRP:
            return new BlockChainWalletHelper(createTestWalletClient(sourceId), em, createTestBlockChainHelper(sourceId));
        default:
            throw new Error(`SourceId not supported ${sourceId}`)
    }
}

export async function createTestAttestationHelper(sourceId: SourceId) {
    switch (sourceId) {
        case SourceId.ALGO:
            return new AttestationHelper(await createTestStateConnectorClient(), createTestBlockChainHelper(sourceId), sourceId);
        case SourceId.BTC:
            return new AttestationHelper(await createTestStateConnectorClient(), createTestBlockChainHelper(sourceId), sourceId);
        case SourceId.DOGE:
            return new AttestationHelper(await createTestStateConnectorClient(), createTestBlockChainHelper(sourceId), sourceId);
        case SourceId.LTC:
            return new AttestationHelper(await createTestStateConnectorClient(), createTestBlockChainHelper(sourceId), sourceId);
        case SourceId.XRP:
            return new AttestationHelper(await createTestStateConnectorClient(), createTestBlockChainHelper(sourceId), sourceId);
        default:
            throw new Error(`SourceId not supported ${sourceId}`)
    }
}

export async function createTestStateConnectorClient() {
    const attestationProviderUrls: string[] = requireEnv('COSTON2_ATTESTER_BASE_URLS').split(",");;
    const attestationClientAddress: string = requireEnv('COSTON2_ATTESTATION_CLIENT_ADDRESS');
    const stateConnectorAddress: string = requireEnv('COSTON2_STATE_CONNECTOR_ADDRESS');
    const account = requireEnv('COSTON2_ACCOUNT');
    return await StateConnectorClientHelper.create(artifacts, attestationProviderUrls, attestationClientAddress, stateConnectorAddress, account); 
}