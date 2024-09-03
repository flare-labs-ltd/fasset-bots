import { PricePublisherState } from "../entities/pricePublisherState";
import { requireNotNull } from "../utils";
import { getWeb3Contract } from "../utils/utils";
import { loadContracts } from "./contracts";
import { createOrm, CreateOrmOptions, ORM } from "./orm";
import { web3 } from "../utils";

export async function createPricePublisherOrm(): Promise<ORM> {
    const options: CreateOrmOptions = {
        type: "sqlite",
        dbName: "price-publisher.db",
        entities: [PricePublisherState],
        allowGlobalContext: true,
        schemaUpdate: "full"
    };
    return createOrm(options);
}

export async function createContractsMap(contractsJsonPath: string, contracts: string[]): Promise<Map<string, any>> {
    const contractsMap = new Map<string, any>();
    const allContracts = loadContracts(requireNotNull(contractsJsonPath));
    for (const c of contracts) {
        const contract = allContracts[c] as any;
        const web3Contract = await getWeb3Contract(web3, contract.address, contract.name);
        contractsMap.set(contract.name, web3Contract);
    }
    return contractsMap;
}