import { UTXOWalletImplementation } from "./UTXOWalletImplementation";
import { ChainType } from "../utils/constants";
import type { BitcoinWalletConfig } from "../interfaces/IWalletTransaction";

export class BtcWalletImplementation extends UTXOWalletImplementation {
   constructor(options: BitcoinWalletConfig) {
      super(options.inTestnet ? ChainType.testBTC : ChainType.BTC, options);
   }
}
