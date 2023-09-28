import Web3 from "web3";

export type TransactionWaitFor =
    | { what: 'receipt'; timeoutMS?: number; }
    | { what: 'nonceIncrease'; pollMS: number; timeoutMS?: number; }
    | { what: 'confirmations'; confirmations: number; timeoutMS?: number; };

export interface ContractSettings {
    web3: Web3;
    defaultOptions: TransactionConfig;
    gasMultiplier: number;
    waitFor: TransactionWaitFor;
    defaultAccount: string | null;
}

// Hardhat format of compiled contract JSON

export interface ContractJson {
    contractName: string;
    sourceName: string;
    abi: AbiItem[];
    bytecode?: string;
    deployedBytecode?: string;
    linkReferences?: ContractJsonLink;
}

export interface ContractJsonLink {
    [sourceName: string]: {
        [contractName: string]: Array<{
            start: number;
            length: number;
        }>;
    };
}
