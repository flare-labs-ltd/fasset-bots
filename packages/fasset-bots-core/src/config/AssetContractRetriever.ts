import { AddressUpdaterInstance, AssetManagerControllerInstance, AssetManagerInstance, Truffle } from "../../typechain-truffle";
import { ZERO_ADDRESS } from "../utils/helpers";
import { CommandLineError, requireNotNullCmd } from "../utils/toplevel";
import { artifacts } from "../utils/web3";
import { ChainContracts, loadContracts } from "./contracts";

const AssetManager = artifacts.require("AssetManager");
const AssetManagerController = artifacts.require("AssetManagerController");
const AddressUpdater = artifacts.require("AddressUpdater");
const FAsset = artifacts.require("FAsset");

export class ContractRetriever {
    constructor(
        public prioritizeAddressUpdater: boolean,
        public addressUpdater: AddressUpdaterInstance,
        public contracts?: ChainContracts,
    ) {}

    async getContractAddress(name: string, addressUpdaterName: string = name) {
        if (this.contracts == null || this.prioritizeAddressUpdater) {
            const address = await this.addressUpdater.getContractAddress(addressUpdaterName);
            if (address !== ZERO_ADDRESS) {
                return address;
            }
        }
        if (this.contracts != null) {
            const address = this.contracts[name]?.address;
            if (address) {
                return address;
            }
        }
        throw new Error(`Cannot find address for contract ${name}`);
    }

    async getContract<T>(factory: Truffle.Contract<T>, name: string = factory.contractName, addressUpdaterName: string = name) {
        const address = await this.getContractAddress(name, addressUpdaterName);
        return await factory.at(address);
    }
}

export class AssetContractRetriever extends ContractRetriever {
    constructor(
        prioritizeAddressUpdater: boolean,
        addressUpdater: AddressUpdaterInstance,
        contracts: ChainContracts | undefined,
        public assetManagerController: AssetManagerControllerInstance,
        public assetManagers: Map<string, AssetManagerInstance>,
    ) {
        super(prioritizeAddressUpdater, addressUpdater, contracts);
    }

    static async create(prioritizeAddressUpdater: boolean, contractsJsonFile?: string, assetManagerControllerAddress?: string) {
        const contracts = contractsJsonFile ? loadContracts(contractsJsonFile) : undefined;
        let assetManagerController: AssetManagerControllerInstance;
        let addressUpdater: AddressUpdaterInstance;
        if (assetManagerControllerAddress) {
            assetManagerController = await AssetManagerController.at(assetManagerControllerAddress);
            addressUpdater = await AddressUpdater.at(await assetManagerController.getAddressUpdater());
        } else if (contracts != null) {
            addressUpdater = await AddressUpdater.at(contracts.AddressUpdater.address);
            const contractRetriever = new ContractRetriever(prioritizeAddressUpdater, addressUpdater, contracts);
            assetManagerController = await contractRetriever.getContract(AssetManagerController);
        } else {
            throw new CommandLineError("At least one of contractsJsonFile or assetManagerController must be defined");
        }
        const assetManagers = await AssetContractRetriever.createAssetManagerMap(assetManagerController);
        return new AssetContractRetriever(prioritizeAddressUpdater, addressUpdater, contracts, assetManagerController, assetManagers);
    }

    getAssetManager(symbol: string) {
        return requireNotNullCmd(this.assetManagers.get(symbol), `No asset manager for FAsset with symbol ${symbol}`);
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
