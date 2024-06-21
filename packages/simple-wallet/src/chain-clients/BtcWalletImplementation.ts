import { UTXOWalletImplementation } from "./UTXOWalletImplementation";
import { ChainType } from "../utils/constants";
import type { BitcoinRpcConfig } from "../interfaces/WriteWalletRpcInterface";

export class BtcWalletImplementation extends UTXOWalletImplementation {
   constructor(options: BitcoinRpcConfig) {
      super(options.inTestnet ? ChainType.testBTC : ChainType.BTC, options);
   }
}
