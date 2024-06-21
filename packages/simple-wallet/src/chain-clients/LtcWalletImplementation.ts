import { UTXOWalletImplementation } from "./UTXOWalletImplementation";
import { ChainType } from "../utils/constants";
import type { LitecoinRpcConfig } from "../interfaces/WriteWalletRpcInterface";

export class LtcWalletImplementation extends UTXOWalletImplementation {
   constructor(options: LitecoinRpcConfig) {
      super(options.inTestnet ? ChainType.testLTC : ChainType.LTC, options);
   }
}
