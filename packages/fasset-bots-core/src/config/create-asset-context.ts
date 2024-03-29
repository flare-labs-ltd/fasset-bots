import { IAssetAgentContext, IAssetNativeChainContext, IChallengerContext, ILiquidatorContext, ITimekeeperContext } from "../fasset-bots/IAssetBotContext";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { assertNotNull } from "../utils/helpers";
import { artifacts } from "../utils/web3";
import { BotConfig, BotFAssetConfig } from "./BotConfig";

const WNat = artifacts.require("WNat");
const IPriceChangeEmitter = artifacts.require("IPriceChangeEmitter");
const FAsset = artifacts.require("FAsset");
const AgentOwnerRegistry = artifacts.require("AgentOwnerRegistry");

/**
 * Creates asset context needed for AgentBot.
 */
export async function createAgentBotContext(botConfig: BotConfig, chainConfig: BotFAssetConfig): Promise<IAssetAgentContext> {
    assertNotNull(chainConfig.wallet, "Missing wallet configuration");
    assertNotNull(chainConfig.blockchainIndexerClient, "Missing blockchain indexer configuration");
    assertNotNull(chainConfig.stateConnector, "Missing state connector configuration");
    assertNotNull(chainConfig.verificationClient, "Missing verification client configuration");
    const nativeContext = await createNativeContext(botConfig, chainConfig);
    return {
        ...nativeContext,
        nativeChainInfo: botConfig.nativeChainInfo,
        chainInfo: chainConfig.chainInfo,
        blockchainIndexer: chainConfig.blockchainIndexerClient,
        wallet: chainConfig.wallet,
        attestationProvider: new AttestationHelper(chainConfig.stateConnector, chainConfig.blockchainIndexerClient, chainConfig.chainInfo.chainId),
        verificationClient: chainConfig.verificationClient,
    };
}

/**
 * Creates asset context for timekeeper.
 */
export async function createTimekeeperContext(config: BotConfig, chainConfig: BotFAssetConfig): Promise<ITimekeeperContext> {
    assertNotNull(chainConfig.blockchainIndexerClient, "Missing blockchain indexer configuration");
    assertNotNull(chainConfig.stateConnector, "Missing state connector configuration");
    const nativeContext = await createNativeContext(config, chainConfig);
    const attestationProvider = new AttestationHelper(chainConfig.stateConnector, chainConfig.blockchainIndexerClient, chainConfig.chainInfo.chainId);
    return {
        ...nativeContext,
        nativeChainInfo: config.nativeChainInfo,
        blockchainIndexer: chainConfig.blockchainIndexerClient,
        attestationProvider: attestationProvider,
    };
}

/**
 * Creates asset context for challenger.
 */
export async function createChallengerContext(config: BotConfig, chainConfig: BotFAssetConfig): Promise<IChallengerContext> {
    const contextWithUnderlyingChain = await createTimekeeperContext(config, chainConfig);
    return {
        ...contextWithUnderlyingChain,
        challengeStrategy: config.challengeStrategy,
    }
}

/**
 * Creates asset context for liquidator.
 */
export async function createLiquidatorContext(config: BotConfig, chainConfig: BotFAssetConfig): Promise<ILiquidatorContext> {
    const nativeContext = await createNativeContext(config, chainConfig);
    return {
        ...nativeContext,
        liquidationStrategy: config.liquidationStrategy,
    };
}

/**
 * Creates lightweight asset context (that only includes native contracts).
 */
export async function createNativeContext(config: BotConfig, chainConfig: BotFAssetConfig): Promise<IAssetNativeChainContext> {
    const retriever = config.contractRetriever;
    const assetManager = chainConfig.assetManager;
    const settings = await assetManager.getSettings();
    return {
        nativeChainInfo: config.nativeChainInfo,
        addressUpdater: retriever.addressUpdater,
        assetManagerController: retriever.assetManagerController,
        agentOwnerRegistry: await AgentOwnerRegistry.at(settings.agentOwnerRegistry),
        assetManager: assetManager,
        fAsset: await FAsset.at(settings.fAsset),
        priceChangeEmitter: await retriever.getContract(IPriceChangeEmitter, chainConfig.priceChangeEmitter ?? "FtsoManager"),
        wNat: await WNat.at(await assetManager.getWNat()),
    }
}
