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
import { requireEnv, toBN } from "../utils/helpers";
import { SourceId } from "../verification/sources/sources";
import { CreateOrmOptions, EM, ORM } from "./orm";
import { AgentBotDefaultSettings, IAssetAgentBotContext } from "../fasset-bots/IAssetBotContext";
import { readFileSync } from "fs";
import { CollateralClass } from "../fasset/AssetManagerTypes";

const OWNER_ADDRESS: string = requireEnv('OWNER_ADDRESS');
const RPC_URL: string = requireEnv('RPC_URL');
const ATTESTATION_PROVIDER_URLS: string  = requireEnv('ATTESTER_BASE_URLS');
const ATTESTATION_CLIENT_ADDRESS: string = requireEnv('ATTESTATION_CLIENT_ADDRESS');
const STATE_CONNECTOR_ADDRESS: string  = requireEnv('STATE_CONNECTOR_ADDRESS');
const DEFAULT_AGENT_SETTINGS_PATH: string = requireEnv('DEFAULT_AGENT_SETTINGS_PATH');

export interface AgentBotRunConfig {
    loopDelay: number;
    nativeChainInfo: NativeChainInfo;
    chainInfos: BotChainInfo[];
    ormOptions: CreateOrmOptions;
    // notifierFile: string;
    // either one must be set
    addressUpdater?: string;
    contractsJsonFile?: string;
}

export interface TrackedStateRunConfig {//TODO
    nativeChainInfo: NativeChainInfo;
    chainInfos: BotChainInfo[];
    // either one must be set
    addressUpdater?: string;
    contractsJsonFile?: string;
}

export interface AgentBotConfig extends TrackedStateConfig{
    loopDelay: number;
    chains: AgentBotConfigChain[];
    orm: ORM;
    notifier: Notifier;
}

export interface TrackedStateConfig {
    rpcUrl: string;
    stateConnector: IStateConnectorClient;
    chains: TrackedStateConfigChain[];
    nativeChainInfo: NativeChainInfo;
    // either one must be set
    addressUpdater?: string;
    contractsJsonFile?: string;
}

export interface AgentBotConfigChain extends TrackedStateConfigChain {
    wallet: IBlockChainWallet;
}

export interface TrackedStateConfigChain {
    chainInfo: ChainInfo;
    chain: IBlockChain;
    blockChainIndexerClient: BlockChainIndexerHelper;
    // either one must be set
    assetManager?: string;
    fAssetSymbol?: string;
}

export interface BotChainInfo extends ChainInfo {
    indexerClientUrl: string;
    indexerClientApiKey?: string;
    inTestnet?: boolean;
    // either one must be set
    assetManager?: string;
    fAssetSymbol?: string;
}

export interface AgentSettingsConfig {
    class1FtsoSymbol: string,
    feeBIPS: string,
    poolFeeShareBIPS: string,
    mintingClass1CollateralRatioConstant: number,
    mintingPoolCollateralRatioConstant: number,
    poolExitCollateralRatioConstant: number,
    buyFAssetByAgentFactorBIPS: string,
    poolTopupCollateralRatioConstant: number,
    poolTopupTokenPriceFactorBIPS: string
}

export async function createAgentBotConfig(runConfig: AgentBotRunConfig): Promise<AgentBotConfig> {
    const attestationProviderUrls = ATTESTATION_PROVIDER_URLS.split(",");
    const stateConnector = await createStateConnectorClient(attestationProviderUrls, ATTESTATION_CLIENT_ADDRESS, STATE_CONNECTOR_ADDRESS, OWNER_ADDRESS);
    const orm = await overrideAndCreateOrm(runConfig.ormOptions);
    const chains: AgentBotConfigChain[] = [];
    for (const chainInfo of runConfig.chainInfos) {
        chains.push(await createAgentBotConfigChain(chainInfo, orm.em));
    }
    return {
        rpcUrl: RPC_URL,
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

export async function createTrackedStateConfig(runConfig: TrackedStateRunConfig): Promise<TrackedStateConfig> {
    const attestationProviderUrls = ATTESTATION_PROVIDER_URLS.split(",");
    const stateConnector = await createStateConnectorClient(attestationProviderUrls, ATTESTATION_CLIENT_ADDRESS, STATE_CONNECTOR_ADDRESS, OWNER_ADDRESS);
    const chains: TrackedStateConfigChain[] = [];
    for (const chainInfo of runConfig.chainInfos) {
        chains.push(await createTrackedStateConfigChain(chainInfo));
    }
    return {
        rpcUrl: RPC_URL,
        stateConnector: stateConnector,
        chains: chains,
        nativeChainInfo: runConfig.nativeChainInfo,
        addressUpdater: runConfig.addressUpdater,
        contractsJsonFile: runConfig.contractsJsonFile
    };
}

export async function createAgentBotConfigChain(chainInfo: BotChainInfo, em: EM): Promise<AgentBotConfigChain> {
    const chain = createBlockChainHelper(chainInfo.chainId);
    const wallet = createBlockChainWalletHelper(chainInfo.chainId, em, chainInfo.inTestnet);
    const blockChainIndexerClient = createBlockChainIndexerHelper(chainInfo.indexerClientUrl, chainInfo.chainId, chainInfo.indexerClientApiKey);
    return {
        chainInfo: chainInfo,
        chain: chain,
        wallet: wallet,
        blockChainIndexerClient: blockChainIndexerClient,
        assetManager: chainInfo.assetManager,
        fAssetSymbol: chainInfo.fAssetSymbol
    };
}

export async function createTrackedStateConfigChain(chainInfo: BotChainInfo): Promise<TrackedStateConfigChain> {
    const chain = createBlockChainHelper(chainInfo.chainId);
    const blockChainIndexerClient = createBlockChainIndexerHelper(chainInfo.indexerClientUrl, chainInfo.chainId, chainInfo.indexerClientApiKey);
    return {
        chainInfo: chainInfo,
        chain: chain,
        blockChainIndexerClient: blockChainIndexerClient,
        assetManager: chainInfo.assetManager,
        fAssetSymbol: chainInfo.fAssetSymbol
    };
}

export async function createAgentBotDefaultSettings(context: IAssetAgentBotContext): Promise<AgentBotDefaultSettings> {
    const agentSettingsConfig = JSON.parse(readFileSync(DEFAULT_AGENT_SETTINGS_PATH).toString()) as AgentSettingsConfig;
    const class1Token = (await context.assetManager.getCollateralTypes()).find(token => {
        return Number(token.collateralClass) === CollateralClass.CLASS1 && token.tokenFtsoSymbol === agentSettingsConfig.class1FtsoSymbol
    });
    if (!class1Token) {
        throw Error(`Invalid class1 collateral token ${agentSettingsConfig.class1FtsoSymbol}`);
    }
    const poolToken = (await context.assetManager.getCollateralTypes()).find(token => {
        return Number(token.collateralClass) === CollateralClass.POOL && token.tokenFtsoSymbol === "NAT"
    });
    if (!poolToken) {
        throw Error(`Cannot find pool collateral token`);
    }
    const agentBotSettings: AgentBotDefaultSettings = {
        class1CollateralToken: class1Token.token,
        feeBIPS: toBN(agentSettingsConfig.feeBIPS),
        poolFeeShareBIPS: toBN(agentSettingsConfig.poolFeeShareBIPS),
        mintingClass1CollateralRatioBIPS: toBN(class1Token.minCollateralRatioBIPS).muln(agentSettingsConfig.mintingClass1CollateralRatioConstant),
        mintingPoolCollateralRatioBIPS: toBN(poolToken.minCollateralRatioBIPS).muln(agentSettingsConfig.mintingPoolCollateralRatioConstant),
        poolExitCollateralRatioBIPS: toBN(poolToken.minCollateralRatioBIPS).muln(agentSettingsConfig.poolExitCollateralRatioConstant),
        buyFAssetByAgentFactorBIPS: toBN(agentSettingsConfig.buyFAssetByAgentFactorBIPS),
        poolTopupCollateralRatioBIPS: toBN(poolToken.minCollateralRatioBIPS).muln(agentSettingsConfig.poolTopupCollateralRatioConstant),
        poolTopupTokenPriceFactorBIPS: toBN(agentSettingsConfig.poolTopupTokenPriceFactorBIPS)
    };
    return agentBotSettings;
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

export function createBlockChainIndexerHelper(indexerWebServerUrl: string, sourceId: SourceId, apiKey: string = ""): BlockChainIndexerHelper {
    switch (sourceId) {
        case SourceId.ALGO:
            return new BlockChainIndexerHelper(indexerWebServerUrl, sourceId, apiKey);
        case SourceId.BTC:
            return new BlockChainIndexerHelper(indexerWebServerUrl, sourceId, apiKey);
        case SourceId.DOGE:
            return new BlockChainIndexerHelper(indexerWebServerUrl, sourceId, apiKey);
        case SourceId.LTC:
            return new BlockChainIndexerHelper(indexerWebServerUrl, sourceId, apiKey);
        case SourceId.XRP:
            return new BlockChainIndexerHelper(indexerWebServerUrl, sourceId, apiKey);
        default:
            throw new Error(`SourceId ${sourceId} not supported.`);
    }
}

export function createBlockChainHelper(sourceId: SourceId): BlockChainHelper {
    switch (sourceId) {
        case SourceId.ALGO:
            return new BlockChainHelper(createMccClient(sourceId));
        case SourceId.BTC:
            return new BlockChainHelper(createMccClient(sourceId));
        case SourceId.DOGE:
            return new BlockChainHelper(createMccClient(sourceId));
        case SourceId.LTC:
            return new BlockChainHelper(createMccClient(sourceId));
        case SourceId.XRP:
            return new BlockChainHelper(createMccClient(sourceId));
        default:
            throw new Error(`SourceId ${sourceId} not supported.`);
    }
}

export function createBlockChainWalletHelper(sourceId: SourceId, em: EntityManager<IDatabaseDriver<Connection>>, inTestnet?: boolean): BlockChainWalletHelper {
    switch (sourceId) {
        case SourceId.ALGO:
            return new BlockChainWalletHelper(createWalletClient(sourceId), em);
        case SourceId.BTC:
            return new BlockChainWalletHelper(createWalletClient(sourceId, inTestnet), em);
        case SourceId.DOGE:
            return new BlockChainWalletHelper(createWalletClient(sourceId, inTestnet), em);
        case SourceId.LTC:
            return new BlockChainWalletHelper(createWalletClient(sourceId, inTestnet), em);
        case SourceId.XRP:
            return new BlockChainWalletHelper(createWalletClient(sourceId), em);
        default:
            throw new Error(`SourceId ${sourceId} not supported.`);
    }
}

export async function createAttestationHelper(sourceId: SourceId, stateConnector: StateConnectorClientHelper): Promise<AttestationHelper> {
    switch (sourceId) {
        case SourceId.ALGO:
            return new AttestationHelper(stateConnector, createBlockChainHelper(sourceId), sourceId);
        case SourceId.BTC:
            return new AttestationHelper(stateConnector, createBlockChainHelper(sourceId), sourceId);
        case SourceId.DOGE:
            return new AttestationHelper(stateConnector, createBlockChainHelper(sourceId), sourceId);
        case SourceId.LTC:
            return new AttestationHelper(stateConnector, createBlockChainHelper(sourceId), sourceId);
        case SourceId.XRP:
            return new AttestationHelper(stateConnector, createBlockChainHelper(sourceId), sourceId);
        default:
            throw new Error(`SourceId ${sourceId} not supported.`);
    }
}

export async function createStateConnectorClient(attestationProviderUrls: string[], attestationClientAddress: string, stateConnectorAddress: string, owner: string): Promise<StateConnectorClientHelper> {
    return await StateConnectorClientHelper.create(artifacts, attestationProviderUrls, attestationClientAddress, stateConnectorAddress, owner);
}
