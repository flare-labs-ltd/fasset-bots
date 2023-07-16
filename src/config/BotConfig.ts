import { UtxoMccCreate, XrpMccCreate } from "@flarenetwork/mcc";
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
import * as dotenv from "dotenv";
dotenv.config();

export interface AgentBotRunConfig extends TrackedStateRunConfig {
    loopDelay: number;
    ormOptions: CreateOrmOptions;
    defaultAgentSettingsPath: string,
    // notifierFile: string;
}

export interface TrackedStateRunConfig {
    nativeChainInfo: NativeChainInfo;
    chainInfos: BotChainInfo[];
    rpcUrl: string,
    attestationProviderUrls: string[],
    stateConnectorAddress: string,
    stateConnectorProofVerifierAddress: string,
    ownerAddress: string,
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
    indexerUrl: string,
    walletUrl: string,
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
        chains.push(await createAgentBotConfigChain(chainInfo, orm.em, runConfig.attestationProviderUrls, runConfig.stateConnectorProofVerifierAddress, runConfig.stateConnectorAddress, runConfig.ownerAddress));
    }
    return {
        rpcUrl: runConfig.rpcUrl,
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
        chains.push(await createTrackedStateConfigChain(chainInfo, runConfig.attestationProviderUrls, runConfig.stateConnectorProofVerifierAddress, runConfig.stateConnectorAddress, runConfig.ownerAddress));
    }
    return {
        rpcUrl: runConfig.rpcUrl,
        chains: chains,
        nativeChainInfo: runConfig.nativeChainInfo,
        addressUpdater: runConfig.addressUpdater,
        contractsJsonFile: runConfig.contractsJsonFile
    };
}

/**
 * Creates AgentBotConfigChain configuration from chain info.
 */
export async function createAgentBotConfigChain(chainInfo: BotChainInfo, em: EM, attestationProviderUrls: string[], scProofVerifierAddress: string, stateConnectorAddress: string, ownerAddress: string): Promise<AgentBotConfigChain> {
    const wallet = createBlockchainWalletHelper(chainInfo.chainId, em, chainInfo.walletUrl, chainInfo.inTestnet);
    const config = await createTrackedStateConfigChain(chainInfo, attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, ownerAddress);
    return {
        ...config,
        wallet: wallet,
    };
}

/**
 * Creates TrackedStateConfigChain configuration from chain info.
 */
export async function createTrackedStateConfigChain(chainInfo: BotChainInfo, attestationProviderUrls: string[], scProofVerifierAddress: string, stateConnectorAddress: string, ownerAddress: string): Promise<TrackedStateConfigChain> {
    const blockchainIndexerClient = createBlockchainIndexerHelper(chainInfo.chainId, chainInfo.indexerUrl);
    const stateConnector = await createStateConnectorClient(chainInfo.indexerUrl, attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, ownerAddress);
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
export async function createAgentBotDefaultSettings(context: IAssetAgentBotContext, agentSettingsConfigPath: string): Promise<AgentBotDefaultSettings> {
    const agentSettingsConfig = JSON.parse(readFileSync(agentSettingsConfigPath).toString()) as AgentSettingsConfig;
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
export function createWalletClient(sourceId: SourceId, walletUrl: string, inTestnet?: boolean): WALLET.ALGO | WALLET.BTC | WALLET.DOGE | WALLET.LTC | WALLET.XRP {
    if (!supportedSourceId(sourceId)) {
        throw new Error(`SourceId ${sourceId} not supported.`);
    }
    if (sourceId === SourceId.BTC) {
        return new WALLET.BTC({
            url: walletUrl,
            username: "",
            password: "",
            inTestnet: inTestnet
        } as UtxoMccCreate);
    } else if (sourceId === SourceId.DOGE) {
        return new WALLET.DOGE({
            url: walletUrl,
            username: "",
            password: "",
            inTestnet: inTestnet
        } as UtxoMccCreate);
    } else {
        return new WALLET.XRP({
            url: walletUrl,
            username: "",
            password: "",
            apiTokenKey: process.env.FLARE_API_PORTAL_KEY
        } as XrpMccCreate);
    }
}

/**
 * Creates blockchain indexer helper. Relevant urls and api keys are provided in .env.
 */
export function createBlockchainIndexerHelper(sourceId: SourceId, indexerUrl: string): BlockchainIndexerHelper {
    if (!supportedSourceId(sourceId)) throw new Error(`SourceId ${sourceId} not supported.`);
    const apiKey = requireEnv('INDEXER_API_KEY');
    return new BlockchainIndexerHelper(indexerUrl, sourceId, apiKey);
}

/**
 * Creates blockchain wallet helper using wallet client.
 */
export function createBlockchainWalletHelper(sourceId: SourceId, em: EntityManager<IDatabaseDriver<Connection>>, walletUrl: string, inTestnet?: boolean): BlockchainWalletHelper {
    if (!supportedSourceId(sourceId)) {
        throw new Error(`SourceId ${sourceId} not supported.`);
    }
    if (sourceId === SourceId.BTC || sourceId === SourceId.DOGE) {
        return new BlockchainWalletHelper(createWalletClient(sourceId, walletUrl, inTestnet), em);
    } else {
        return new BlockchainWalletHelper(createWalletClient(sourceId, walletUrl), em);
    }
}

/**
 * Creates attestation helper.
 */
export async function createAttestationHelper(sourceId: SourceId, attestationProviderUrls: string[], scProofVerifierAddress: string, stateConnectorAddress: string, owner: string, indexerUrl: string): Promise<AttestationHelper> {
    if (!supportedSourceId(sourceId)) throw new Error(`SourceId ${sourceId} not supported.`);
    const stateConnector = await createStateConnectorClient(indexerUrl, attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, owner);
    return new AttestationHelper(stateConnector, createBlockchainIndexerHelper(sourceId, indexerUrl), sourceId);
}

/**
 * Creates state connector client
 */
export async function createStateConnectorClient(indexerWebServerUrl: string, attestationProviderUrls: string[], scProofVerifierAddress: string, stateConnectorAddress: string, owner: string): Promise<StateConnectorClientHelper> {
    const apiKey = requireEnv('INDEXER_API_KEY');
    return await StateConnectorClientHelper.create(attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, indexerWebServerUrl, apiKey, owner);
}


function supportedSourceId(sourceId: SourceId) {
    if (sourceId === SourceId.XRP || sourceId === SourceId.BTC || sourceId === SourceId.DOGE) {
        return true;
    }
    return false;
}