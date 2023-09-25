import { AddressUpdaterInstance, AssetManagerControllerInstance } from "../../typechain-truffle";
import { IAssetAgentBotContext, IAssetActorContext } from "../fasset-bots/IAssetBotContext";
import { CollateralType, CollateralClass } from "../fasset/AssetManagerTypes";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { fail } from "../utils/helpers";
import { artifacts } from "../utils/web3";
import { BotConfig, BotFAssetConfig } from "./BotConfig";
import { ChainContracts, loadContracts } from "./contracts";

const AssetManager = artifacts.require("AssetManager");
const AssetManagerController = artifacts.require("AssetManagerController");
const AddressUpdater = artifacts.require("AddressUpdater");
const WNat = artifacts.require("WNat");
const IPriceChangeEmitter = artifacts.require("IPriceChangeEmitter");
const FAsset = artifacts.require("FAsset");
const IERC20 = artifacts.require("IERC20");

/**
 * Creates asset context needed for AgentBot.
 */
export async function createAssetContext(botConfig: BotConfig, chainConfig: BotFAssetConfig): Promise<IAssetAgentBotContext> {
    if (!botConfig.addressUpdater && !botConfig.contractsJsonFile) {
        throw new Error("Either contractsJsonFile or addressUpdater must be defined");
    }
    if (!chainConfig.wallet) {
        throw new Error("Missing wallet configuration");
    }
    let assetManager;
    let priceChangeEmitter;
    let wNat;
    let addressUpdater;
    const priceChangeEmitterName = chainConfig.priceChangeEmitter ?? "FtsoManager";
    if (botConfig.contractsJsonFile) {
        const contracts: ChainContracts = loadContracts(botConfig.contractsJsonFile);
        [assetManager] = await getAssetManagerAndController(chainConfig, null, contracts);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        priceChangeEmitter = await IPriceChangeEmitter.at(contracts[priceChangeEmitterName]!.address);
        wNat = await WNat.at(contracts.WNat.address);
        addressUpdater = await AddressUpdater.at(contracts.AddressUpdater.address);
    } else {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        addressUpdater = await AddressUpdater.at(botConfig.addressUpdater!);
        [assetManager] = await getAssetManagerAndController(chainConfig, addressUpdater, null);
        priceChangeEmitter = await IPriceChangeEmitter.at(await addressUpdater.getContractAddress(priceChangeEmitterName));
        wNat = await WNat.at(await addressUpdater.getContractAddress("WNat"));
    }
    const collaterals = await assetManager.getCollateralTypes();
    const stableCoins = await createStableCoins(collaterals);
    return {
        nativeChainInfo: botConfig.nativeChainInfo,
        chainInfo: chainConfig.chainInfo,
        blockchainIndexer: chainConfig.blockchainIndexerClient,
        wallet: chainConfig.wallet,
        attestationProvider: new AttestationHelper(chainConfig.stateConnector, chainConfig.blockchainIndexerClient, chainConfig.chainInfo.chainId),
        assetManager: assetManager,
        priceChangeEmitter: priceChangeEmitter,
        wNat: wNat,
        fAsset: await FAsset.at(await assetManager.fAsset()),
        collaterals: collaterals,
        stablecoins: stableCoins,
        addressUpdater: addressUpdater,
    };
}

/**
 * Creates lightweight asset context needed for Tracked State (for challenger and liquidator).
 */
export async function createActorAssetContext(trackedStateConfig: BotConfig, chainConfig: BotFAssetConfig): Promise<IAssetActorContext> {
    if (!trackedStateConfig.addressUpdater && !trackedStateConfig.contractsJsonFile) {
        throw new Error("Either contractsJsonFile or addressUpdater must be defined");
    }
    let assetManager;
    let priceChangeEmitter;
    const priceChangeEmitterName = chainConfig.priceChangeEmitter ?? "FtsoManager";
    if (trackedStateConfig.contractsJsonFile) {
        const contracts: ChainContracts = loadContracts(trackedStateConfig.contractsJsonFile);
        [assetManager] = await getAssetManagerAndController(chainConfig, null, contracts);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        priceChangeEmitter = await IPriceChangeEmitter.at(contracts[priceChangeEmitterName]!.address);
    } else {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const addressUpdater = await AddressUpdater.at(trackedStateConfig.addressUpdater!);
        [assetManager] = await getAssetManagerAndController(chainConfig, addressUpdater, null);
        priceChangeEmitter = await IPriceChangeEmitter.at(await addressUpdater.getContractAddress(priceChangeEmitterName));
    }
    const collaterals: CollateralType[] = await assetManager.getCollateralTypes();
    return {
        nativeChainInfo: trackedStateConfig.nativeChainInfo,
        blockchainIndexer: chainConfig.blockchainIndexerClient,
        attestationProvider: new AttestationHelper(chainConfig.stateConnector, chainConfig.blockchainIndexerClient, chainConfig.chainInfo.chainId),
        assetManager: assetManager,
        priceChangeEmitter: priceChangeEmitter,
        fAsset: await FAsset.at(await assetManager.fAsset()),
        collaterals: collaterals,
    };
}

// utils

async function getAssetManagerAndController(chainConfig: BotFAssetConfig, addressUpdater: AddressUpdaterInstance | null, contracts: ChainContracts | null) {
    if (chainConfig.assetManager) {
        const assetManager = await AssetManager.at(chainConfig.assetManager);
        const assetManagerController = await AssetManagerController.at(await assetManager.assetManagerController());
        return [assetManager, assetManagerController] as const;
    } else if (chainConfig.fAssetSymbol) {
        /* istanbul ignore next */ //TODO until AssetManagerController gets verified in explorer
        const controllerAddress =
            addressUpdater != null
                ? await addressUpdater.getContractAddress("AssetManagerController")
                : contracts != null
                ? contracts.AssetManagerController.address
                : fail("Either addressUpdater or contracts must be defined");
        const assetManagerController = await AssetManagerController.at(controllerAddress);
        const assetManager = await findAssetManager(assetManagerController, chainConfig.fAssetSymbol);
        return [assetManager, assetManagerController] as const;
    } else {
        throw new Error(`assetManager or fAssetSymbol required in chain config`);
    }
}

async function findAssetManager(assetManagerController: AssetManagerControllerInstance, fAssetSymbol: string) {
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

async function createStableCoins(collaterals: CollateralType[]) {
    const stableCoinsArray = collaterals.filter((token) => Number(token.collateralClass) === CollateralClass.VAULT);
    const stableCoins: { [key: string]: any } = {};
    for (const collateralToken of stableCoinsArray) {
        const tokenName: string = collateralToken.tokenFtsoSymbol;
        const token = await IERC20.at(collateralToken.token);
        stableCoins[tokenName] = token;
    }
    return stableCoins;
}
