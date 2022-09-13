import { BotConfig, BotConfigChain } from "../../src/config/BotConfig";
import { IAssetContext } from "../../src/fasset/IAssetContext";
import { AttestationHelper } from "../../src/underlying-chain/AttestationHelper";
import { UnderlyingChainEvents } from "../../src/underlying-chain/UnderlyingChainEvents";
import { artifacts } from "../../src/utils/artifacts";

const AssetManager = artifacts.require('AssetManager');
const AssetManagerController = artifacts.require('AssetManagerController');
const AddressUpdater = artifacts.require('AddressUpdater');
const WNat = artifacts.require('WNat');
const IIFtso = artifacts.require('IIFtso');
const IFtsoRegistry = artifacts.require('IFtsoRegistry');
const IFtsoManager = artifacts.require('IFtsoManager');
const FAsset = artifacts.require('FAsset');

export async function createAssetContext(botConfig: BotConfig, chainConfig: BotConfigChain): Promise<IAssetContext> {
    const assetManager = await AssetManager.at(chainConfig.assetManager);
    const addressUpdater = await AddressUpdater.at(botConfig.addressUpdater);
    const ftsoRegistry = await IFtsoRegistry.at(await addressUpdater.getContractAddress('FtsoRegistry'));
    const settings = await assetManager.getSettings();
    return {
        chainInfo: chainConfig.chainInfo,
        chain: chainConfig.chain,
        chainEvents: new UnderlyingChainEvents(chainConfig.chain, chainConfig.chainEvents, null),
        wallet: chainConfig.wallet,
        attestationProvider: new AttestationHelper(botConfig.stateConnector, chainConfig.chain, chainConfig.chainInfo.chainId),
        assetManager: assetManager,
        assetManagerController: await AssetManagerController.at(await addressUpdater.getContractAddress('AssetManagerController')),
        ftsoRegistry: ftsoRegistry,
        ftsoManager: await IFtsoManager.at(await addressUpdater.getContractAddress('FtsoManager')),
        wnat: await WNat.at(await addressUpdater.getContractAddress('WNat')),
        fAsset: await FAsset.at(await assetManager.fAsset()),
        natFtso: await IIFtso.at(await ftsoRegistry.getFtsoBySymbol(settings.natFtsoSymbol)),
        assetFtso: await IIFtso.at(await ftsoRegistry.getFtsoBySymbol(settings.assetFtsoSymbol)),
    };
}

function installTestContracts() {
    
}
