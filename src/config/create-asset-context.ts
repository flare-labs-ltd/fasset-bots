import { AddressUpdaterInstance, AssetManagerControllerInstance, IFtsoRegistryInstance } from "../../typechain-truffle";
import { IAssetAgentBotContext } from "../fasset-bots/IAssetBotContext";
import { CollateralType, CollateralClass } from "../fasset/AssetManagerTypes";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { artifacts } from "../utils/artifacts";
import { fail } from "../utils/helpers";
import { AgentBotConfig, AgentBotConfigChain } from "./BotConfig";
import { ChainContracts, loadContracts } from "./contracts";

const AssetManager = artifacts.require('AssetManager');
const AssetManagerController = artifacts.require('AssetManagerController');
const AddressUpdater = artifacts.require('AddressUpdater');
const WNat = artifacts.require('WNat');
const IIFtso = artifacts.require('IIFtso');
const IFtsoRegistry = artifacts.require('IFtsoRegistry');
const IFtsoManager = artifacts.require('IFtsoManager');
const FAsset = artifacts.require('FAsset');
const IERC20 = artifacts.require('IERC20');

export async function createAssetContext(botConfig: AgentBotConfig, chainConfig: AgentBotConfigChain): Promise<IAssetAgentBotContext> {
    if (botConfig.contractsJsonFile) {
        return await createAssetContextFromContracts(botConfig as AgentBotConfig & { contractsJsonFile: string }, chainConfig);
    } else if (botConfig.addressUpdater) {
        return await createAssetContextFromAddressUpdater(botConfig as AgentBotConfig & { addressUpdater: string }, chainConfig);
    } else {
        throw new Error('Either contractsJsonFile or addressUpdater must be defined');
    }
}

async function createAssetContextFromContracts(botConfig: AgentBotConfig & { contractsJsonFile: string }, chainConfig: AgentBotConfigChain): Promise<IAssetAgentBotContext> {
    const contracts: ChainContracts = loadContracts(botConfig.contractsJsonFile);
    const ftsoRegistry = await IFtsoRegistry.at(contracts.FtsoRegistry.address);
    const [assetManager, assetManagerController] = await getAssetManagerAndController(chainConfig, null, contracts);
    const collaterals: CollateralType[] = await assetManager.getCollateralTypes();
    const natFtsoSymbol: string = collaterals[0].tokenFtsoSymbol;
    const natFtso = await IIFtso.at(await ftsoRegistry.getFtsoBySymbol(natFtsoSymbol));
    const assetFtso = await IIFtso.at(await ftsoRegistry.getFtsoBySymbol(chainConfig.chainInfo.symbol));
    const ftsos = await createFtsos(collaterals, ftsoRegistry, chainConfig.chainInfo.symbol);
    const stableCoins = await createStableCoins(collaterals);
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
        wNat: await WNat.at(contracts.WNat.address),
        fAsset: await FAsset.at(await assetManager.fAsset()),
        natFtso: natFtso,
        assetFtso: assetFtso,
        blockChainIndexerClient: chainConfig.blockChainIndexerClient,
        collaterals: collaterals,
        stablecoins: stableCoins,
        ftsos: ftsos
    };
}

async function createAssetContextFromAddressUpdater(botConfig: AgentBotConfig & { addressUpdater: string }, chainConfig: AgentBotConfigChain): Promise<IAssetAgentBotContext> {
    const addressUpdater = await AddressUpdater.at(botConfig.addressUpdater);
    const ftsoRegistry = await IFtsoRegistry.at(await addressUpdater.getContractAddress('FtsoRegistry'));
    const [assetManager, assetManagerController] = await getAssetManagerAndController(chainConfig, addressUpdater, null);
    const collaterals = await assetManager.getCollateralTypes();
    const natFtsoSymbol: string = collaterals[0].tokenFtsoSymbol;
    const natFtso = await IIFtso.at(await ftsoRegistry.getFtsoBySymbol(natFtsoSymbol));
    const assetFtso = await IIFtso.at(await ftsoRegistry.getFtsoBySymbol(chainConfig.chainInfo.symbol));
    const ftsos = await createFtsos(collaterals, ftsoRegistry, chainConfig.chainInfo.symbol);
    const stableCoins = await createStableCoins(collaterals);
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
        wNat: await WNat.at(await addressUpdater.getContractAddress('WNat')),
        fAsset: await FAsset.at(await assetManager.fAsset()),
        natFtso: natFtso,
        assetFtso: assetFtso,
        blockChainIndexerClient: chainConfig.blockChainIndexerClient,
        collaterals: collaterals,
        stablecoins: stableCoins,
        ftsos: ftsos
    };
}

async function getAssetManagerAndController(chainConfig: AgentBotConfigChain, addressUpdater: AddressUpdaterInstance | null, contracts: ChainContracts | null) {
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

async function createFtsos(collaterals: CollateralType[], ftsoRegistry: IFtsoRegistryInstance, assetFtsoSymbol: string) {
    const assetFtso = await IIFtso.at(await ftsoRegistry.getFtsoBySymbol(assetFtsoSymbol));
    const ftsos = {}
    Object.defineProperty(ftsos, 'asset', assetFtso);
    for (const collateralToken of collaterals) {
        const tokenName = collateralToken.tokenFtsoSymbol.toLowerCase();
        const tokenFtso = await IIFtso.at(await ftsoRegistry.getFtsoBySymbol(collateralToken.tokenFtsoSymbol));
        Object.defineProperty(ftsos, tokenName, tokenFtso);
    }
    return ftsos;
}

async function createStableCoins(collaterals: CollateralType[]) {
    const stableCoinsArray = collaterals.filter(token => token.collateralClass === CollateralClass.CLASS1);
    const stableCoins = {};
    for (const collateralToken of stableCoinsArray) {
        const tokenName = collateralToken.tokenFtsoSymbol;
        const token = await IERC20.at(collateralToken.token);
        Object.defineProperty(stableCoins, tokenName, token);
    }
    return stableCoins;
}
