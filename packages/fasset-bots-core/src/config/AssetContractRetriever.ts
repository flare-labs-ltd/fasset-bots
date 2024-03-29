import { AddressUpdaterInstance, AssetManagerControllerInstance, AssetManagerInstance, Truffle } from "../../typechain-truffle";
import { assertNotNullCmd, requireNotNullCmd } from "../utils/toplevel";
import { artifacts } from "../utils/web3";
import { ChainContracts, loadContracts } from "./contracts";

const AssetManager = artifacts.require("AssetManager");
const AssetManagerController = artifacts.require("AssetManagerController");
const AddressUpdater = artifacts.require("AddressUpdater");
const FAsset = artifacts.require("FAsset");

export class AssetContractRetriever {
    assetManagerController!: AssetManagerControllerInstance;
    addressUpdater!: AddressUpdaterInstance;
    assetManagers!: Map<string, AssetManagerInstance>;
    contracts?: ChainContracts;

    async initialize(contractsJsonFile: string | undefined, assetManagerControllerAddress: string | undefined) {
        if (contractsJsonFile) {
            this.contracts = loadContracts(contractsJsonFile);
        }
        if (assetManagerControllerAddress) {
            this.assetManagerController = await AssetManagerController.at(assetManagerControllerAddress);
            this.addressUpdater = await AddressUpdater.at(await this.assetManagerController.getAddressUpdater());
        } else {
            assertNotNullCmd(this.contracts, "At least one of contractsJsonFile or assetManagerController must be defined");
            this.addressUpdater = await AddressUpdater.at(this.contracts.AddressUpdater.address);
            this.assetManagerController = await this.getContract(AssetManagerController);
        }
        this.assetManagers = await AssetContractRetriever.createAssetManagerMap(this.assetManagerController);
    }

    async getContractAddress(name: string, addressUpdaterName: string = name) {
        if (this.contracts) {
            return requireNotNullCmd(this.contracts[name]?.address, `Cannot find address for ${name}`);
        } else {
            try {
                return await this.addressUpdater.getContractAddress(addressUpdaterName);
            } catch (e) {
                throw new Error(`Cannot find address for ${name}`);
            }
        }
    }

    async getContract<T>(factory: Truffle.Contract<T>, name: string = factory.contractName, addressUpdaterName: string = name) {
        const address = await this.getContractAddress(name, addressUpdaterName);
        return await factory.at(address);
    }

    static async createAssetManagerMap(assetManagerController: AssetManagerControllerInstance) {
        const map = new Map<string, AssetManagerInstance>();
        for (const assetManagerAddress of await assetManagerController.getAssetManagers()) {
            const assetManager = await AssetManager.at(assetManagerAddress);
            const fasset = await FAsset.at(await assetManager.fAsset());
            const symbol = await fasset.symbol();
            map.set(symbol, assetManager);
        }
        return map;
    }
}
