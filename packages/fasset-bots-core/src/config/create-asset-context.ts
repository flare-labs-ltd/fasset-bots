import { IAssetAgentContext, IAssetNativeChainContext, IChallengerContext, ILiquidatorContext, ITimekeeperContext } from "../fasset-bots/IAssetBotContext";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { artifacts } from "../utils/web3";
import { AgentBotConfig, BotConfig, BotFAssetConfig, BotFAssetConfigWithIndexer, BotFAssetConfigWithWallet, KeeperBotConfig, UserBotConfig } from "./BotConfig";

const WNat = artifacts.require("WNat");
const IPriceChangeEmitter = artifacts.require("IPriceChangeEmitter");
const FAsset = artifacts.require("FAsset");
const AgentOwnerRegistry = artifacts.require("AgentOwnerRegistry");

/**
 * Creates asset context needed for AgentBot.
 */
export async function createAgentBotContext(botConfig: AgentBotConfig | UserBotConfig, chainConfig: BotFAssetConfigWithWallet): Promise<IAssetAgentContext> {
    const nativeContext = await createNativeContext(botConfig, chainConfig);
    return {
        ...nativeContext,
        nativeChainInfo: botConfig.nativeChainInfo,
        chainInfo: chainConfig.chainInfo,
        blockchainIndexer: chainConfig.blockchainIndexerClient,
        wallet: chainConfig.wallet,
        attestationProvider: new AttestationHelper(chainConfig.flareDataConnector, chainConfig.blockchainIndexerClient, chainConfig.chainInfo.chainId),
        verificationClient: chainConfig.verificationClient,
    };
}

/**
 * Creates asset context for timekeeper.
 */
export async function createTimekeeperContext(botConfig: KeeperBotConfig, chainConfig: BotFAssetConfigWithIndexer): Promise<ITimekeeperContext> {
    const nativeContext = await createNativeContext(botConfig, chainConfig);
    const attestationProvider = new AttestationHelper(chainConfig.flareDataConnector, chainConfig.blockchainIndexerClient, chainConfig.chainInfo.chainId);
    return {
        ...nativeContext,
        nativeChainInfo: botConfig.nativeChainInfo,
        blockchainIndexer: chainConfig.blockchainIndexerClient,
        attestationProvider: attestationProvider,
    };
}

/**
 * Creates asset context for challenger.
 */
export async function createChallengerContext(config: KeeperBotConfig, chainConfig: BotFAssetConfigWithIndexer): Promise<IChallengerContext> {
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
        fAssetSymbol: chainConfig.fAssetSymbol,
        nativeChainInfo: config.nativeChainInfo,
        addressUpdater: retriever.addressUpdater,
        assetManagerController: retriever.assetManagerController,
        agentOwnerRegistry: await AgentOwnerRegistry.at(settings.agentOwnerRegistry),
        assetManager: assetManager,
        fAsset: await FAsset.at(settings.fAsset),
        priceChangeEmitter: await retriever.getContract(IPriceChangeEmitter, chainConfig.priceChangeEmitter),
        wNat: await WNat.at(await assetManager.getWNat()),
    }
}

export function isAssetAgentContext(context: IAssetNativeChainContext): context is IAssetAgentContext {
    return "wallet" in context;
}
