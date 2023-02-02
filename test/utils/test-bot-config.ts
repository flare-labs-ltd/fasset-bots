import { BotConfig, BotConfigChain, createBlockChainHelper, createBlockChainWalletHelper, createBlockChainIndexerHelper, createStateConnectorClient } from "../../src/config/BotConfig";
import { loadContracts } from "../../src/config/contracts";
import { EM, ORM } from "../../src/config/orm";
import { MockChain, MockChainWallet } from "../../src/mock/MockChain";
import { MockStateConnectorClient } from "../../src/mock/MockStateConnectorClient";
import { artifacts } from "../../src/utils/artifacts";
import { testChainInfo, TestChainInfo } from "./TestChainInfo";

const LOCAL_HARDHAT_RPC = "http://127.0.0.1:8545";
const CONTRACTS_JSON = "../fasset/deployment/deploys/hardhat.json";

const StateConnectorMock = artifacts.require("StateConnectorMock");

export async function createTestConfig(chains: string[] = ['btc', 'xrp'], orm: ORM): Promise<BotConfig> {
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
        },
        orm: orm
    }
}

function createMockChainConfig(fAssetSymbol: string, info: TestChainInfo, stateConnectorClient: MockStateConnectorClient): BotConfigChain {
    const chain = new MockChain();
    chain.finalizationBlocks = info.finalizationBlocks;
    chain.secondsPerBlock = info.blockTime;
    stateConnectorClient.addChain(info.chainId, chain);
    return {
        chain: chain,
        chainInfo: info,
        wallet: new MockChainWallet(chain),
        fAssetSymbol: fAssetSymbol,
        blockChainIndexerClient: createBlockChainIndexerHelper(info.chainId)
    };
}

export async function createTestConfigNoMocks(chains: string[] = ['btc', 'xrp'], orm: ORM, rpcUrl: string, contractJson: string): Promise<BotConfig> {
    const stateConnectorClient = await createStateConnectorClient();
    const chainConfigs: BotConfigChain[] = [];
    if (chains.includes('btc')) {
        chainConfigs.push(createChainConfig('FtestBTC', testChainInfo.btc, orm.em));
    }
    if (chains.includes('xrp')) {
        chainConfigs.push(createChainConfig('FtestXRP', testChainInfo.xrp, orm.em));
    }
    return {
        rpcUrl: rpcUrl,
        loopDelay: 0,
        contractsJsonFile: contractJson,
        stateConnector: stateConnectorClient,
        chains: chainConfigs,
        nativeChainInfo: {
            finalizationBlocks: 0,
            readLogsChunkSize: 10,
        },
        orm: orm
    }
}

function createChainConfig(fAssetSymbol: string, info: TestChainInfo, em: EM): BotConfigChain {
    const chain = createBlockChainHelper(info.chainId);
    chain.finalizationBlocks = info.finalizationBlocks;
    chain.secondsPerBlock = info.blockTime;
    const wallet = createBlockChainWalletHelper(info.chainId, em);
    const indexer = createBlockChainIndexerHelper(info.chainId);
    return {
        chain: chain,
        chainInfo: info,
        wallet: wallet,
        fAssetSymbol: fAssetSymbol,
        blockChainIndexerClient: indexer
    };
}