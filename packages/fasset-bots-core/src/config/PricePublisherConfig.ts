import { requireNotNull } from "../utils";
import { getWeb3Contract, WaitFinalizeOptions } from "../utils/utils";
import { loadContracts } from "./contracts";
import { web3 } from "../utils";


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

export const waitFinalizeOptions: WaitFinalizeOptions = { extraBlocks: 2, retries: 3, sleepMS: 1000 };