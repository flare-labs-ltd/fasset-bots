import { AlgoMccCreate, MCC, UtxoMccCreate, XrpMccCreate } from "@flarenetwork/mcc";
import { Connection } from "@mikro-orm/core/connections/Connection";
import { IDatabaseDriver } from "@mikro-orm/core/drivers/IDatabaseDriver";
import { EntityManager } from "@mikro-orm/core/EntityManager";
import { WALLET } from "simple-wallet";
import { ChainInfo, NativeChainInfo } from "../fasset/ChainInfo";
import { overrideAndCreateOrm } from "../mikro-orm.config";
import { Notifier } from "../utils/Notifier";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { BlockchainIndexerHelper } from "../underlying-chain/BlockchainIndexerHelper";
import { IBlockChainWallet } from "../underlying-chain/interfaces/IBlockChainWallet";
import { IStateConnectorClient } from "../underlying-chain/interfaces/IStateConnectorClient";
import { StateConnectorClientHelper } from "../underlying-chain/StateConnectorClientHelper";
import { requireEnv, toBN } from "../utils/helpers";
import { SourceId } from "../verification/sources/sources";
import { CreateOrmOptions, EM, ORM } from "./orm";
import { AgentBotDefaultSettings, IAssetAgentBotContext } from "../fasset-bots/IAssetBotContext";
import { readFileSync } from "fs";
import { CollateralClass } from "../fasset/AssetManagerTypes";
import { BlockchainWalletHelper } from "../underlying-chain/BlockchainWalletHelper";

const OWNER_ADDRESS: string = requireEnv('OWNER_ADDRESS');
const RPC_URL: string = requireEnv('RPC_URL');
const ATTESTATION_PROVIDER_URLS: string = requireEnv('ATTESTER_BASE_URLS');
const STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS: string = requireEnv('STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS');
const STATE_CONNECTOR_ADDRESS: string = requireEnv('STATE_CONNECTOR_ADDRESS');
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

export interface TrackedStateRunConfig {
    nativeChainInfo: NativeChainInfo;
    chainInfos: BotChainInfo[];
    // either one must be set
    addressUpdater?: string;
    contractsJsonFile?: string;
}

export interface AgentBotConfig extends TrackedStateConfig {
    loopDelay: number;
    chains: AgentBotConfigChain[];
    orm: ORM;
    notifier: Notifier;
}

export interface TrackedStateConfig {
    rpcUrl: string;
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
    blockchainIndexerClient: BlockchainIndexerHelper;
    stateConnector: IStateConnectorClient;
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

/**
 * Creates AgentBot configuration from initial run config file.
 */
export async function createAgentBotConfig(runConfig: AgentBotRunConfig): Promise<AgentBotConfig> {
    const orm = await overrideAndCreateOrm(runConfig.ormOptions);
    const chains: AgentBotConfigChain[] = [];
    for (const chainInfo of runConfig.chainInfos) {
        chains.push(await createAgentBotConfigChain(chainInfo, orm.em));
    }
    return {
        rpcUrl: RPC_URL,
        loopDelay: runConfig.loopDelay,
        chains: chains,
        nativeChainInfo: runConfig.nativeChainInfo,
        orm: orm,
        notifier: new Notifier(),
        addressUpdater: runConfig.addressUpdater,
        contractsJsonFile: runConfig.contractsJsonFile
    };
}

/**
 * Creates Tracked State (for challenger and liquidator) configuration from initial run config file, which is more lightweight.
 */
export async function createTrackedStateConfig(runConfig: TrackedStateRunConfig): Promise<TrackedStateConfig> {
    const chains: TrackedStateConfigChain[] = [];
    for (const chainInfo of runConfig.chainInfos) {
        chains.push(await createTrackedStateConfigChain(chainInfo));
    }
    return {
        rpcUrl: RPC_URL,
        chains: chains,
        nativeChainInfo: runConfig.nativeChainInfo,
        addressUpdater: runConfig.addressUpdater,
        contractsJsonFile: runConfig.contractsJsonFile
    };
}

/**
 * Creates AgentBotConfigChain configuration from chain info.
 */
export async function createAgentBotConfigChain(chainInfo: BotChainInfo, em: EM, attestationProviderUrls?: string[], scProofVerifierAddress?: string, stateConnectorAddress?: string, owner?: string): Promise<AgentBotConfigChain> {
    const wallet = createBlockchainWalletHelper(chainInfo.chainId, em, chainInfo.inTestnet);
    const blockchainIndexerClient = createBlockchainIndexerHelper(chainInfo.chainId);
    const apUrls = attestationProviderUrls ? attestationProviderUrls : ATTESTATION_PROVIDER_URLS.split(",");
    const acAddress = scProofVerifierAddress ? scProofVerifierAddress : STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS;
    const scAddress = stateConnectorAddress ? stateConnectorAddress : STATE_CONNECTOR_ADDRESS;
    const ownerAddress = owner ? owner : OWNER_ADDRESS;
    const stateConnector = await createStateConnectorClient(chainInfo.chainId, apUrls, acAddress, scAddress, ownerAddress);
    return {
        chainInfo: chainInfo,
        wallet: wallet,
        blockchainIndexerClient: blockchainIndexerClient,
        stateConnector: stateConnector,
        assetManager: chainInfo.assetManager,
        fAssetSymbol: chainInfo.fAssetSymbol
    };
}

/**
 * Creates TrackedStateConfigChain configuration from chain info.
 */
export async function createTrackedStateConfigChain(chainInfo: BotChainInfo, attestationProviderUrls?: string[], scProofVerifierAddress?: string, stateConnectorAddress?: string, owner?: string): Promise<TrackedStateConfigChain> {
    const blockchainIndexerClient = createBlockchainIndexerHelper(chainInfo.chainId);
    const apUrls = attestationProviderUrls ? attestationProviderUrls : ATTESTATION_PROVIDER_URLS.split(",");
    const acAddress = scProofVerifierAddress ? scProofVerifierAddress : STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS;
    const scAddress = stateConnectorAddress ? stateConnectorAddress : STATE_CONNECTOR_ADDRESS;
    const ownerAddress = owner ? owner : OWNER_ADDRESS;
    const stateConnector = await createStateConnectorClient(chainInfo.chainId, apUrls, acAddress, scAddress, ownerAddress);
    return {
        chainInfo: chainInfo,
        blockchainIndexerClient: blockchainIndexerClient,
        stateConnector: stateConnector,
        assetManager: chainInfo.assetManager,
        fAssetSymbol: chainInfo.fAssetSymbol
    };
}

/**
 * Creates agents initial settings from AgentSettingsConfig, that are needed for agent to be created.
 */
export async function createAgentBotDefaultSettings(context: IAssetAgentBotContext, agentSettingsConfig = JSON.parse(readFileSync(DEFAULT_AGENT_SETTINGS_PATH).toString()) as AgentSettingsConfig): Promise<AgentBotDefaultSettings> {
    const class1Token = (await context.assetManager.getCollateralTypes()).find(token => {
        return Number(token.collateralClass) === CollateralClass.CLASS1 && token.tokenFtsoSymbol === agentSettingsConfig.class1FtsoSymbol
    });
    if (!class1Token) {
        throw Error(`Invalid class1 collateral token ${agentSettingsConfig.class1FtsoSymbol}`);
    }
    const poolToken = await context.assetManager.getCollateralType(CollateralClass.POOL, await context.assetManager.getWNat());
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

/**
 * Creates wallet client.
 */
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

/**
 * Creates blockchain indexer helper. Relevant urls and api keys are provided in .env.
 */
export function createBlockchainIndexerHelper(sourceId: SourceId): BlockchainIndexerHelper {
    switch (sourceId) {
        case SourceId.BTC: {
            const indexerWebServerUrl = requireEnv('INDEXER_BTC_WEB_SERVER_URL');
            const apiKey = requireEnv('INDEXER_BTC_API_KEY');
            return new BlockchainIndexerHelper(indexerWebServerUrl, sourceId, apiKey);
        }
        case SourceId.DOGE: {
            const indexerWebServerUrl = requireEnv('INDEXER_DOGE_WEB_SERVER_URL');
            const apiKey = requireEnv('INDEXER_DOGE_API_KEY');
            return new BlockchainIndexerHelper(indexerWebServerUrl, sourceId, apiKey);
        }
        case SourceId.XRP: {
            const indexerWebServerUrl = requireEnv('INDEXER_XRP_WEB_SERVER_URL');
            const apiKey = requireEnv('INDEXER_XRP_API_KEY');
            return new BlockchainIndexerHelper(indexerWebServerUrl, sourceId, apiKey);
        }
        default:
            throw new Error(`SourceId ${sourceId} not supported.`);
    }
}

/**
 * Creates blockchain wallet helper using wallet client.
 */
export function createBlockchainWalletHelper(sourceId: SourceId, em: EntityManager<IDatabaseDriver<Connection>>, inTestnet?: boolean): BlockchainWalletHelper {
    switch (sourceId) {
        case SourceId.ALGO:
            return new BlockchainWalletHelper(createWalletClient(sourceId), em);
        case SourceId.BTC:
            return new BlockchainWalletHelper(createWalletClient(sourceId, inTestnet), em);
        case SourceId.DOGE:
            return new BlockchainWalletHelper(createWalletClient(sourceId, inTestnet), em);
        case SourceId.LTC:
            return new BlockchainWalletHelper(createWalletClient(sourceId, inTestnet), em);
        case SourceId.XRP:
            return new BlockchainWalletHelper(createWalletClient(sourceId), em);
        default:
            throw new Error(`SourceId ${sourceId} not supported.`);
    }
}

/**
 * Creates attestation helper.
 */
export async function createAttestationHelper(sourceId: SourceId, attestationProviderUrls: string[], scProofVerifierAddress: string, stateConnectorAddress: string, owner: string): Promise<AttestationHelper> {

    switch (sourceId) {
        case SourceId.BTC: {
            const stateConnector = await createStateConnectorClient(sourceId, attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, owner);
            return new AttestationHelper(stateConnector, createBlockchainIndexerHelper(sourceId), sourceId);
        }
        case SourceId.DOGE: {
            const stateConnector = await createStateConnectorClient(sourceId, attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, owner);
            return new AttestationHelper(stateConnector, createBlockchainIndexerHelper(sourceId), sourceId);
        }
        case SourceId.XRP: {
            const stateConnector = await createStateConnectorClient(sourceId, attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, owner);
            return new AttestationHelper(stateConnector, createBlockchainIndexerHelper(sourceId), sourceId);
        }
        default:
            throw new Error(`SourceId ${sourceId} not supported.`);
    }
}

/**
 * Creates state connector client
 */
export async function createStateConnectorClient(sourceId: SourceId, attestationProviderUrls: string[], scProofVerifierAddress: string, stateConnectorAddress: string, owner: string): Promise<StateConnectorClientHelper> {
    switch (sourceId) {
        case SourceId.BTC: {
            const indexerWebServerUrl = requireEnv('INDEXER_BTC_WEB_SERVER_URL');
            const apiKey = requireEnv('INDEXER_BTC_API_KEY');
            return await StateConnectorClientHelper.create(attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, indexerWebServerUrl, apiKey, owner);
        }
        case SourceId.DOGE: {
            const indexerWebServerUrl = requireEnv('INDEXER_DOGE_WEB_SERVER_URL');
            const apiKey = requireEnv('INDEXER_DOGE_API_KEY');
            return await StateConnectorClientHelper.create(attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, indexerWebServerUrl, apiKey, owner);
        }
        case SourceId.XRP: {
            const indexerWebServerUrl = requireEnv('INDEXER_XRP_WEB_SERVER_URL');
            const apiKey = requireEnv('INDEXER_XRP_API_KEY');
            return await StateConnectorClientHelper.create(attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, indexerWebServerUrl, apiKey, owner);
        }
        default:
            throw new Error(`SourceId ${sourceId} not supported.`);
    }
}