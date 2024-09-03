import { resolveInFassetBotsCore } from "../utils/package-paths";
import { JsonLoader } from "./json-loader";

export interface Contract {
    name: string;
    contractName: string;
    address: string;
    mustSwitchToProduction?: boolean;
}

export type ContractList = Contract[];

export interface ChainContracts {
    // flare smart contract
    GovernanceSettings: Contract;
    AddressUpdater: Contract;
    StateConnector: Contract;
    WNat: Contract;
    FtsoManager: Contract;
    FtsoRegistry: Contract;
    // fasset
    SCProofVerifier: Contract;
    AgentVaultFactory: Contract;
    AssetManagerController: Contract;
    AssetManagerWhitelist?: Contract;
    CollateralPoolFactory: Contract;
    CollateralPoolTokenFactory: Contract;
    PriceReader: Contract;
    AgentOwnerRegistry: Contract;
    Relay: Contract;
    FtsoV2PriceStore: Contract;
    // others (asset managers & fassets & everything from flare-smart-contract)
    [key: string]: Contract | undefined;
}

export function newContract(name: string, contractName: string, address: string) {
    return { name, contractName, address };
}

const contractsLoader = new JsonLoader<Contract[]>(resolveInFassetBotsCore("run-config/schema/contracts.schema.json"), "contracts.json");

export function loadContracts(filename: string): ChainContracts {
    const result: any = {};
    const contractsList = contractsLoader.load(filename);
    for (const contract of contractsList) {
        result[contract.name] = contract;
    }
    return result as ChainContracts;
}
