import { AddressUpdaterInstance, AssetManagerControllerInstance, IFtsoRegistryInstance } from "../../typechain-truffle";
import { IAssetAgentBotContext, IAssetActorContext } from "../fasset-bots/IAssetBotContext";
import { CollateralType, CollateralClass } from "../fasset/AssetManagerTypes";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { artifacts } from "../utils/artifacts";
import { createFtsosHelper } from "../utils/fasset-helpers";
import { fail } from "../utils/helpers";
import { BotConfig, BotChainConfig } from "./BotConfig";
import { ChainContracts, loadContracts } from "./contracts";

const AssetManager = artifacts.require("AssetManager");
const AssetManagerController = artifacts.require("AssetManagerController");
const AddressUpdater = artifacts.require("AddressUpdater");
const WNat = artifacts.require("WNat");
const IIFtso = artifacts.require("IIFtso");
const IFtsoRegistry = artifacts.require("IFtsoRegistry");
const IFtsoManager = artifacts.require("IFtsoManager");
const FAsset = artifacts.require("FAsset");
const IERC20 = artifacts.require("IERC20");

/**
 * Creates asset context needed for AgentBot.
 */
export async function createAssetContext(botConfig: BotConfig, chainConfig: BotChainConfig): Promise<IAssetAgentBotContext> {
    if (!botConfig.addressUpdater && !botConfig.contractsJsonFile) {
        throw new Error("Either contractsJsonFile or addressUpdater must be defined");
    }
    if (!chainConfig.wallet) {
        throw new Error("Missing wallet configuration");
    }
    let ftsoRegistry;
    let assetManager;
    let assetManagerController;
    let ftsoManager;
    let wNat;
    let addressUpdater;
    if (botConfig.contractsJsonFile) {
        const contracts: ChainContracts = loadContracts(botConfig.contractsJsonFile);
        ftsoRegistry = await IFtsoRegistry.at(contracts.FtsoRegistry.address);
        [assetManager, assetManagerController] = await getAssetManagerAndController(chainConfig, null, contracts);
        ftsoManager = await IFtsoManager.at(contracts.FtsoManager.address);
        wNat = await WNat.at(contracts.WNat.address);
        addressUpdater = await AddressUpdater.at(contracts.AddressUpdater.address);
    } else {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        addressUpdater = await AddressUpdater.at(botConfig.addressUpdater!);
        ftsoRegistry = await IFtsoRegistry.at(await addressUpdater.getContractAddress("FtsoRegistry"));
        [assetManager, assetManagerController] = await getAssetManagerAndController(chainConfig, addressUpdater, null);
        ftsoManager = await IFtsoManager.at(await addressUpdater.getContractAddress("FtsoManager"));
        wNat = await WNat.at(await addressUpdater.getContractAddress("WNat"));
    }
    const collaterals = await assetManager.getCollateralTypes();
    const ftsos = await createFtsos(collaterals, ftsoRegistry, chainConfig.chainInfo.symbol);
    const stableCoins = await createStableCoins(collaterals);
    return {
        nativeChainInfo: botConfig.nativeChainInfo,
        chainInfo: chainConfig.chainInfo,
        blockchainIndexer: chainConfig.blockchainIndexerClient,
        wallet: chainConfig.wallet,
        attestationProvider: new AttestationHelper(chainConfig.stateConnector, chainConfig.blockchainIndexerClient, chainConfig.chainInfo.chainId),
        assetManager: assetManager,
        assetManagerController: assetManagerController,
        ftsoRegistry: ftsoRegistry,
        ftsoManager: ftsoManager,
        wNat: wNat,
        fAsset: await FAsset.at(await assetManager.fAsset()),
        natFtso: ftsos["nat"],
        assetFtso: ftsos["asset"],
        collaterals: collaterals,
        stablecoins: stableCoins,
        ftsos: ftsos,
        addressUpdater: addressUpdater,
    };
}

/**
 * Creates lightweight asset context needed for Tracked State (for challenger and liquidator).
 */
export async function createActorAssetContext(trackedStateConfig: BotConfig, chainConfig: BotChainConfig): Promise<IAssetActorContext> {
    if (!trackedStateConfig.addressUpdater && !trackedStateConfig.contractsJsonFile) {
        throw new Error("Either contractsJsonFile or addressUpdater must be defined");
    }
    let ftsoRegistry;
    let assetManager;
    let ftsoManager;
    if (trackedStateConfig.contractsJsonFile) {
        const contracts: ChainContracts = loadContracts(trackedStateConfig.contractsJsonFile);
        ftsoRegistry = await IFtsoRegistry.at(contracts.FtsoRegistry.address);
        [assetManager] = await getAssetManagerAndController(chainConfig, null, contracts);
        ftsoManager = await IFtsoManager.at(contracts.FtsoManager.address);
    } else {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const addressUpdater = await AddressUpdater.at(trackedStateConfig.addressUpdater!);
        ftsoRegistry = await IFtsoRegistry.at(await addressUpdater.getContractAddress("FtsoRegistry"));
        [assetManager] = await getAssetManagerAndController(chainConfig, addressUpdater, null);
        ftsoManager = await IFtsoManager.at(await addressUpdater.getContractAddress("FtsoManager"));
    }

    const collaterals: CollateralType[] = await assetManager.getCollateralTypes();
    const assetFtso = await IIFtso.at(await ftsoRegistry.getFtsoBySymbol(chainConfig.chainInfo.symbol));
    return {
        nativeChainInfo: trackedStateConfig.nativeChainInfo,
        blockchainIndexer: chainConfig.blockchainIndexerClient,
        attestationProvider: new AttestationHelper(chainConfig.stateConnector, chainConfig.blockchainIndexerClient, chainConfig.chainInfo.chainId),
        assetManager: assetManager,
        ftsoRegistry: ftsoRegistry,
        ftsoManager: ftsoManager,
        fAsset: await FAsset.at(await assetManager.fAsset()),
        assetFtso: assetFtso,
        collaterals: collaterals,
    };
}

// utils

async function getAssetManagerAndController(chainConfig: BotChainConfig, addressUpdater: AddressUpdaterInstance | null, contracts: ChainContracts | null) {
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

async function createFtsos(collaterals: CollateralType[], ftsoRegistry: IFtsoRegistryInstance, assetFtsoSymbol: string) {
    const assetFtso = await IIFtso.at(await ftsoRegistry.getFtsoBySymbol(assetFtsoSymbol));
    const ftsos: { [key: string]: any } = {};
    ftsos["asset"] = assetFtso;
    for (const collateralToken of collaterals) {
        const tokenName = collateralToken.tokenFtsoSymbol;
        const tokenFtso = await createFtsosHelper(ftsoRegistry, collateralToken.tokenFtsoSymbol);
        ftsos[tokenName.toLowerCase()] = tokenFtso;
    }
    return ftsos;
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
