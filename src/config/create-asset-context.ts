import { IAssetContext } from "../fasset/IAssetContext";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { UnderlyingChainEvents } from "../underlying-chain/UnderlyingChainEvents";
import { artifacts } from "../utils/artifacts";
import { BotConfig, BotConfigChain } from "./BotConfig";

const AssetManager = artifacts.require('AssetManager');
const AssetManagerController = artifacts.require('AssetManagerController');
const AddressUpdater = artifacts.require('AddressUpdater');
const WNat = artifacts.require('WNat');
const IIFtso = artifacts.require('IIFtso');
const IFtsoRegistry = artifacts.require('IFtsoRegistry');
const IFtsoManager = artifacts.require('IFtsoManager');
const FAsset = artifacts.require('FAsset');

export async function createAssetContextFromAddressUpdater(botConfig: BotConfig & { addressUpdater: string }, chainConfig: BotConfigChain): Promise<IAssetContext> {
    const addressUpdater = await AddressUpdater.at(botConfig.addressUpdater);
    const assetManager = await AssetManager.at(chainConfig.assetManager);
    const ftsoRegistry = await IFtsoRegistry.at(await addressUpdater.getContractAddress('FtsoRegistry'));
    const settings = await assetManager.getSettings();
    return {
        chainInfo: chainConfig.chainInfo,
        chain: chainConfig.chain,
        chainEvents: new UnderlyingChainEvents(chainConfig.chain, chainConfig.chainEvents, null),
        wallet: chainConfig.wallet,
        attestationProvider: new AttestationHelper(botConfig.stateConnector, chainConfig.chain, chainConfig.chainInfo.chainId),
        assetManager: assetManager,
        assetManagerController: await AssetManagerController.at(await assetManager.assetManagerController()),
        ftsoRegistry: ftsoRegistry,
        ftsoManager: await IFtsoManager.at(await addressUpdater.getContractAddress('FtsoManager')),
        wnat: await WNat.at(await addressUpdater.getContractAddress('WNat')),
        fAsset: await FAsset.at(await assetManager.fAsset()),
        natFtso: await IIFtso.at(await ftsoRegistry.getFtsoBySymbol(settings.natFtsoSymbol)),
        assetFtso: await IIFtso.at(await ftsoRegistry.getFtsoBySymbol(settings.assetFtsoSymbol)),
    };
}
