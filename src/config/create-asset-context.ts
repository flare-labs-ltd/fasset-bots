import { AddressUpdaterInstance, AssetManagerControllerInstance } from "../../typechain-truffle";
import { IAssetBotContext } from "../fasset-bots/IAssetBotContext";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { artifacts } from "../utils/artifacts";
import { fail } from "../utils/helpers";
import { BotConfig, BotConfigChain } from "./BotConfig";
import { ChainContracts, loadContracts } from "./contracts";

const AssetManager = artifacts.require('AssetManager');
const AssetManagerController = artifacts.require('AssetManagerController');
const AddressUpdater = artifacts.require('AddressUpdater');
const WNat = artifacts.require('WNat');
const IIFtso = artifacts.require('IIFtso');
const IFtsoRegistry = artifacts.require('IFtsoRegistry');
const IFtsoManager = artifacts.require('IFtsoManager');
const FAsset = artifacts.require('FAsset');

export async function createAssetContext(botConfig: BotConfig, chainConfig: BotConfigChain): Promise<IAssetBotContext> {
    if (botConfig.contractsJsonFile) {
        return await createAssetContextFromContracts(botConfig as BotConfig & { contractsJsonFile: string }, chainConfig);
    } else if (botConfig.addressUpdater) {
        return await createAssetContextFromAddressUpdater(botConfig as BotConfig & { addressUpdater: string }, chainConfig);
    } else {
        throw new Error('Either contractsJsonFile or addressUpdater must be defined');
    }
}

async function createAssetContextFromContracts(botConfig: BotConfig & { contractsJsonFile: string }, chainConfig: BotConfigChain): Promise<IAssetBotContext> {
    const contracts = loadContracts(botConfig.contractsJsonFile);
    const ftsoRegistry = await IFtsoRegistry.at(contracts.FtsoRegistry.address);
    const [assetManager, assetManagerController] = await getAssetManagerAndController(chainConfig, null, contracts);
    const settings = await assetManager.getSettings();
    return {
        nativeChainInfo: botConfig.nativeChainInfo,
        chainInfo: chainConfig.chainInfo,
        chain: chainConfig.chain,
        wallet: chainConfig.wallet,
        attestationProvider: new AttestationHelper(botConfig.stateConnector, chainConfig.chain, chainConfig.chainInfo.chainId),
        assetManager: assetManager,
        assetManagerController: assetManagerController,
        ftsoRegistry: ftsoRegistry,
        ftsoManager: await IFtsoManager.at(contracts.FtsoManager.address),
        wnat: await WNat.at(contracts.WNat.address),
        fAsset: await FAsset.at(await assetManager.fAsset()),
        natFtso: await IIFtso.at(await ftsoRegistry.getFtsoBySymbol(settings.natFtsoSymbol)),
        assetFtso: await IIFtso.at(await ftsoRegistry.getFtsoBySymbol(settings.assetFtsoSymbol)),
        blockChainIndexerClient: chainConfig.blockChainIndexerClient
    };
}

async function createAssetContextFromAddressUpdater(botConfig: BotConfig & { addressUpdater: string }, chainConfig: BotConfigChain): Promise<IAssetBotContext> {
    const addressUpdater = await AddressUpdater.at(botConfig.addressUpdater);
    const ftsoRegistry = await IFtsoRegistry.at(await addressUpdater.getContractAddress('FtsoRegistry'));
    const [assetManager, assetManagerController] = await getAssetManagerAndController(chainConfig, addressUpdater, null);
    const settings = await assetManager.getSettings();
    return {
        nativeChainInfo: botConfig.nativeChainInfo,
        chainInfo: chainConfig.chainInfo,
        chain: chainConfig.chain,
        wallet: chainConfig.wallet,
        attestationProvider: new AttestationHelper(botConfig.stateConnector, chainConfig.chain, chainConfig.chainInfo.chainId),
        assetManager: assetManager,
        assetManagerController: assetManagerController,
        ftsoRegistry: ftsoRegistry,
        ftsoManager: await IFtsoManager.at(await addressUpdater.getContractAddress('FtsoManager')),
        wnat: await WNat.at(await addressUpdater.getContractAddress('WNat')),
        fAsset: await FAsset.at(await assetManager.fAsset()),
        natFtso: await IIFtso.at(await ftsoRegistry.getFtsoBySymbol(settings.natFtsoSymbol)),
        assetFtso: await IIFtso.at(await ftsoRegistry.getFtsoBySymbol(settings.assetFtsoSymbol)),
        blockChainIndexerClient: chainConfig.blockChainIndexerClient
    };
}

async function getAssetManagerAndController(chainConfig: BotConfigChain, addressUpdater: AddressUpdaterInstance | null, contracts: ChainContracts | null) {
    if (chainConfig.assetManager) {
        const assetManager = await AssetManager.at(chainConfig.assetManager);
        const assetManagerController = await AssetManagerController.at(await assetManager.assetManagerController());
        return [assetManager, assetManagerController] as const;
    } else if (chainConfig.fAssetSymbol) {
        const controllerAddress =
            addressUpdater != null ? await addressUpdater.getContractAddress('AssetManagerController') :
                contracts != null ? contracts.AssetManagerController.address :
                    fail('Either addressUpdater or contracts must be defined');
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
        if (await fAsset.symbol() === fAssetSymbol) {
            return assetManager;
        }
    }
    throw new Error(`FAsset symbol ${fAssetSymbol} not found`);
}
