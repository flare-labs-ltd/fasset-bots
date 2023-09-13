import "dotenv/config";

import { UtxoMccCreate, XrpMccCreate } from "@flarenetwork/mcc";
import { EntityManager } from "@mikro-orm/core/EntityManager";
import { Connection } from "@mikro-orm/core/connections/Connection";
import { IDatabaseDriver } from "@mikro-orm/core/drivers/IDatabaseDriver";
import { readFileSync } from "fs";
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
import { requireEnv, toBN } from "../utils/helpers";
import { SourceId } from "../verification/sources/sources";
import { CreateOrmOptions, EM, ORM } from "./orm";

export interface BotConfigFile {
    defaultAgentSettingsPath?: string; // only for agent bot
    ormOptions?: CreateOrmOptions; // only for agent bot
    chainInfos: BotChainInfo[];
    // notifierFile: string;
    loopDelay: number;
    nativeChainInfo: NativeChainInfo;
    rpcUrl: string;
    attestationProviderUrls: string[];
    stateConnectorAddress: string;
    stateConnectorProofVerifierAddress: string;
    // either one must be set
    addressUpdater?: string;
    contractsJsonFile?: string;
}

export interface BotChainInfo extends ChainInfo {
    walletUrl?: string; // only for agent bot
    inTestnet?: boolean; // only for agent bot, optional also for agent bot
    indexerUrl: string;
    // either one must be set
    assetManager?: string;
    fAssetSymbol?: string;
}

export interface BotConfig {
    orm?: ORM; // only for agent bot
    notifier?: Notifier; // only for agent bot
    loopDelay: number;
    rpcUrl: string;
    chains: BotChainConfig[];
    nativeChainInfo: NativeChainInfo;
    // either one must be set
    addressUpdater?: string;
    contractsJsonFile?: string;
}

export interface BotChainConfig {
    wallet?: IBlockChainWallet; // only for agent bot
    chainInfo: ChainInfo;
    blockchainIndexerClient: BlockchainIndexerHelper;
    stateConnector: IStateConnectorClient;
    // either one must be set
    assetManager?: string;
    fAssetSymbol?: string;
}

export interface AgentSettingsConfig {
    vaultCollateralFtsoSymbol: string;
    poolTokenSuffix: string;
    feeBIPS: string;
    poolFeeShareBIPS: string;
    mintingVaultCollateralRatioConstant: number;
    mintingPoolCollateralRatioConstant: number;
    poolExitCollateralRatioConstant: number;
    buyFAssetByAgentFactorBIPS: string;
    poolTopupCollateralRatioConstant: number;
    poolTopupTokenPriceFactorBIPS: string;
}

/**
 * Creates bot configuration from initial run config file.
 */
export async function createBotConfig(runConfig: BotConfigFile, ownerAddress: string): Promise<BotConfig> {
    const orm = runConfig.ormOptions ? await overrideAndCreateOrm(runConfig.ormOptions) : undefined;
    const chains: BotChainConfig[] = [];
    for (const chainInfo of runConfig.chainInfos) {
        chains.push(
            await createBotChainConfig(
                chainInfo,
                orm ? orm.em : undefined,
                runConfig.attestationProviderUrls,
                runConfig.stateConnectorProofVerifierAddress,
                runConfig.stateConnectorAddress,
                ownerAddress
            )
        );
    }
    return {
        rpcUrl: runConfig.rpcUrl,
        loopDelay: runConfig.loopDelay,
        chains: chains,
        nativeChainInfo: runConfig.nativeChainInfo,
        orm: orm ? orm : undefined,
        notifier: new Notifier(),
        addressUpdater: runConfig.addressUpdater,
        contractsJsonFile: runConfig.contractsJsonFile,
    };
}

/**
 * Creates BotChainConfig configuration from chain info.
 */
export async function createBotChainConfig(
    chainInfo: BotChainInfo,
    em: EM | undefined,
    attestationProviderUrls: string[],
    scProofVerifierAddress: string,
    stateConnectorAddress: string,
    ownerAddress: string
): Promise<BotChainConfig> {
    const wallet = chainInfo.walletUrl && em ? createBlockchainWalletHelper(chainInfo.chainId, em, chainInfo.walletUrl, chainInfo.inTestnet) : undefined;
    const config = await createChainConfig(chainInfo, attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, ownerAddress);
    return {
        ...config,
        wallet: wallet,
    };
}

/**
 * Helper for BotChainConfig configuration from chain info.
 */
export async function createChainConfig(
    chainInfo: BotChainInfo,
    attestationProviderUrls: string[],
    scProofVerifierAddress: string,
    stateConnectorAddress: string,
    ownerAddress: string
): Promise<BotChainConfig> {
    const blockchainIndexerClient = createBlockchainIndexerHelper(chainInfo.chainId, chainInfo.indexerUrl, chainInfo.finalizationBlocks);
    const stateConnector = await createStateConnectorClient(
        chainInfo.indexerUrl,
        attestationProviderUrls,
        scProofVerifierAddress,
        stateConnectorAddress,
        ownerAddress
    );
    return {
        chainInfo: chainInfo,
        blockchainIndexerClient: blockchainIndexerClient,
        stateConnector: stateConnector,
        assetManager: chainInfo.assetManager,
        fAssetSymbol: chainInfo.fAssetSymbol,
    };
}

/**
 * Creates agents initial settings from AgentSettingsConfig, that are needed for agent to be created.
 */
export async function createAgentBotDefaultSettings(context: IAssetAgentBotContext, agentSettingsConfigPath: string): Promise<AgentBotDefaultSettings> {
    const agentSettingsConfig = JSON.parse(readFileSync(agentSettingsConfigPath).toString()) as AgentSettingsConfig;
    const vaultCollateralToken = (await context.assetManager.getCollateralTypes()).find((token) => {
        return Number(token.collateralClass) === CollateralClass.VAULT && token.tokenFtsoSymbol === agentSettingsConfig.vaultCollateralFtsoSymbol;
    });
    if (!vaultCollateralToken) {
        throw new Error(`Invalid vault collateral token ${agentSettingsConfig.vaultCollateralFtsoSymbol}`);
    }
    const poolToken = await context.assetManager.getCollateralType(CollateralClass.POOL, await context.assetManager.getWNat());
    const agentBotSettings: AgentBotDefaultSettings = {
        vaultCollateralToken: vaultCollateralToken.token,
        poolTokenSuffix: agentSettingsConfig.poolTokenSuffix + "-" + vaultCollateralToken.tokenFtsoSymbol,
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
 */
export function createWalletClient(
    sourceId: SourceId,
    walletUrl: string,
    inTestnet?: boolean
): WALLET.ALGO | WALLET.BTC | WALLET.DOGE | WALLET.LTC | WALLET.XRP {
    if (!supportedSourceId(sourceId)) {
        throw new Error(`SourceId ${sourceId} not supported.`);
    }
    if (sourceId === SourceId.BTC) {
        return new WALLET.BTC({
            url: walletUrl,
            username: "",
            password: "",
            inTestnet: inTestnet,
        } as UtxoMccCreate);
    } else if (sourceId === SourceId.DOGE) {
        return new WALLET.DOGE({
            url: walletUrl,
            username: "",
            password: "",
            inTestnet: inTestnet,
        } as UtxoMccCreate);
    } else {
        return new WALLET.XRP({
            url: walletUrl,
            username: "",
            password: "",
            apiTokenKey: process.env.FLARE_API_PORTAL_KEY,
        } as XrpMccCreate);
    }
}

/**
 * Creates blockchain indexer helper. Relevant urls and api keys are provided in .env.
 */
export function createBlockchainIndexerHelper(sourceId: SourceId, indexerUrl: string, finalizationBlocks: number): BlockchainIndexerHelper {
    if (!supportedSourceId(sourceId)) throw new Error(`SourceId ${sourceId} not supported.`);
    const apiKey = requireEnv("INDEXER_API_KEY");
    return new BlockchainIndexerHelper(indexerUrl, sourceId, finalizationBlocks, apiKey);
}

/**
 * Creates blockchain wallet helper using wallet client.
 */
export function createBlockchainWalletHelper(
    sourceId: SourceId,
    em: EntityManager<IDatabaseDriver<Connection>>,
    walletUrl: string,
    inTestnet?: boolean
): BlockchainWalletHelper {
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
 */
export async function createStateConnectorClient(
    indexerWebServerUrl: string,
    attestationProviderUrls: string[],
    scProofVerifierAddress: string,
    stateConnectorAddress: string,
    owner: string
): Promise<StateConnectorClientHelper> {
    const apiKey = requireEnv("INDEXER_API_KEY");
    return await StateConnectorClientHelper.create(attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, indexerWebServerUrl, apiKey, owner);
}

function supportedSourceId(sourceId: SourceId) {
    if (sourceId === SourceId.XRP || sourceId === SourceId.BTC || sourceId === SourceId.DOGE) {
        return true;
    }
    return false;
}
