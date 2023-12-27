import { Truffle } from "../../../typechain-truffle";
import { RawEvent, Web3EventDecoder } from "./Web3EventDecoder";
import { EvmEvent } from "./common";

interface Web3EventDecoderOptions {
    filter?: Array<string | undefined>;
    requireKnownAddress?: boolean;
}

export class Web3ContractEventDecoder extends Web3EventDecoder {
    public contractNames = new Map<string, string>(); // address => name
    public requireKnownAddress: boolean;

    constructor(contracts: { [name: string]: Truffle.ContractInstance }, options?: Web3EventDecoderOptions) {
        super();
        this.requireKnownAddress = options?.requireKnownAddress ?? false;
        this.addContracts(contracts, options?.filter);
    }

    addContracts(contracts: { [name: string]: Truffle.ContractInstance }, filter?: Array<string | undefined>) {
        for (const contractName of Object.keys(contracts)) {
            const contract = contracts[contractName];
            this.contractNames.set(contract.address, contractName);
            this.addEvents(contract.abi, filter);
        }
    }

    decodeEvent(event: RawEvent): EvmEvent | null {
        if (this.requireKnownAddress && !this.contractNames.has(event.address)) {
            return null;
        }
        return super.decodeEvent(event);
    }
}
