import { AddressUpdaterInstance, AssetManagerControllerInstance, AssetManagerInstance } from "../../typechain-truffle";
import { IAssetAgentContext, IAssetNativeChainContext, IChallengerContext, ILiquidatorContext, ITimekeeperContext } from "../fasset-bots/IAssetBotContext";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { assertNotNull, fail } from "../utils/helpers";
import { artifacts } from "../utils/web3";
import { BotConfig, BotFAssetConfig } from "./BotConfig";
import { BotConfigFile, BotFAssetInfo } from "./config-files/BotConfigFile";
import { ChainContracts, loadContracts } from "./contracts";

const AssetManager = artifacts.require("AssetManager");
const AssetManagerController = artifacts.require("AssetManagerController");
const AddressUpdater = artifacts.require("AddressUpdater");
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
 * Creates lightweight asset context (for timekeeper).
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
 * Creates lightweight asset context (for challenger).
 */
export async function createChallengerContext(config: BotConfig, chainConfig: BotFAssetConfig): Promise<IChallengerContext> {
    const contextWithUnderlyingChain = await createTimekeeperContext(config, chainConfig);
    return {
        ...contextWithUnderlyingChain,
        challengeStrategy: config.challengeStrategy,
    }
}

/**
 * Creates lightweight asset context (for liquidator).
 */
export async function createLiquidatorContext(config: BotConfig | BotConfigFile, chainConfig: BotFAssetConfig | BotFAssetInfo): Promise<ILiquidatorContext> {
    const nativeContext = await createNativeContext(config, chainConfig);
    return {
        ...nativeContext,
        liquidationStrategy: config.liquidationStrategy,
    };
}

/**
 * Creates lightweight asset context (for liquidator).
 */
export async function createNativeContext(config: BotConfig | BotConfigFile, chainConfig: BotFAssetConfig | BotFAssetInfo): Promise<IAssetNativeChainContext> {
    if (!config.addressUpdater && !config.contractsJsonFile) {
        throw new Error("Either contractsJsonFile or addressUpdater must be defined");
    }
    const priceChangeEmitterName = chainConfig.priceChangeEmitter ?? "FtsoManager";
    if (config.contractsJsonFile) {
        const contracts: ChainContracts = loadContracts(config.contractsJsonFile);
        const [assetManager, assetManagerController] = await getAssetManagerAndController(chainConfig, null, contracts);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const priceChangeEmitter = await IPriceChangeEmitter.at(contracts[priceChangeEmitterName]!.address);
        const wNat = await WNat.at(contracts.WNat.address);
        const addressUpdater = await AddressUpdater.at(contracts.AddressUpdater.address);
        const fAsset = await FAsset.at(await assetManager.fAsset());
        const agentOwnerRegistry = await AgentOwnerRegistry.at(contracts.AgentOwnerRegistry.address);
        return { nativeChainInfo: config.nativeChainInfo, addressUpdater, assetManager, assetManagerController, wNat, fAsset, priceChangeEmitter, agentOwnerRegistry };
    } else {
        assertNotNull(config.addressUpdater);
        const addressUpdater = await AddressUpdater.at(config.addressUpdater);
        const [assetManager, assetManagerController] = await getAssetManagerAndController(chainConfig, addressUpdater, null);
        const settings = await assetManager.getSettings();
        const priceChangeEmitter = await IPriceChangeEmitter.at(await addressUpdater.getContractAddress(priceChangeEmitterName));
        const wNat = await WNat.at(await addressUpdater.getContractAddress("WNat"));
        const fAsset = await FAsset.at(await assetManager.fAsset());
        const agentOwnerRegistry = await AgentOwnerRegistry.at(settings.agentOwnerRegistry);
        return { nativeChainInfo: config.nativeChainInfo, addressUpdater, assetManager, assetManagerController, wNat, fAsset, priceChangeEmitter, agentOwnerRegistry };
    }
}

// utils

async function getAssetManagerAndController(
    chainConfig: BotFAssetConfig | BotFAssetInfo,
    addressUpdater: AddressUpdaterInstance | null,
    contracts: ChainContracts | null
) {
    if (chainConfig.assetManager) {
        const assetManager = await AssetManager.at(chainConfig.assetManager);
        const assetManagerController = await AssetManagerController.at(await assetManager.assetManagerController());
        return [assetManager, assetManagerController] as const;
    } else if (chainConfig.fAssetSymbol) {
        /* istanbul ignore next */ //TODO until AssetManagerController gets verified in explorer
        const controllerAddress =
            addressUpdater != null ? await addressUpdater.getContractAddress("AssetManagerController")
            : contracts != null ? contracts.AssetManagerController.address
            : fail("Either addressUpdater or contracts must be defined");
        const assetManagerController = await AssetManagerController.at(controllerAddress);
        const assetManager = await findAssetManager(assetManagerController, chainConfig.fAssetSymbol);
        return [assetManager, assetManagerController] as const;
    } else {
        throw new Error(`assetManager or fAssetSymbol required in chain config`);
    }
}

async function findAssetManager(assetManagerController: AssetManagerControllerInstance, fAssetSymbol: string): Promise<AssetManagerInstance> {
    const assetManagers = await assetManagerController.getAssetManagers();
    for (const addr of assetManagers) {
        const assetManager = await AssetManager.at(addr);
        const fAsset = await FAsset.at(await assetManager.fAsset());
        if ((await fAsset.symbol()) === fAssetSymbol) {
            return assetManager;
        }
    }
    throw new Error(`FAsset symbol ${fAssetSymbol} not found`);
}
