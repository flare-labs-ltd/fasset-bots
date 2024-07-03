import { UTXOWalletImplementation } from "./UTXOWalletImplementation";
import { ChainType } from "../utils/constants";
import type { LitecoinWalletConfig } from "../interfaces/WriteWalletInterface";

export class LtcWalletImplementation extends UTXOWalletImplementation {
   constructor(options: LitecoinWalletConfig) {
      super(options.inTestnet ? ChainType.testLTC : ChainType.LTC, options);
   }
}
