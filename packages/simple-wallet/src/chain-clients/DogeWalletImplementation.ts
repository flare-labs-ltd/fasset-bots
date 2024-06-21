import { UTXOWalletImplementation } from "./UTXOWalletImplementation";
import { ChainType } from "../utils/constants";
import type { DogecoinRpcConfig } from "../interfaces/WriteWalletRpcInterface";

export class DogeWalletImplementation extends UTXOWalletImplementation {
   constructor(options: DogecoinRpcConfig) {
      super(options.inTestnet ? ChainType.testDOGE : ChainType.DOGE, options);
   }
}
