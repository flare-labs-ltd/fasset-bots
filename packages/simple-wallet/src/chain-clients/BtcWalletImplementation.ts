import { BtcishWalletImplementation } from "./BtcishWalletImplementation";
import { ChainType } from "../utils/constants";
import type { BitcoinRpcConfig } from "../interfaces/WriteWalletRpcInterface";

export class BtcWalletImplementation extends BtcishWalletImplementation {
   constructor(options: BitcoinRpcConfig) {
      super(options.inTestnet ? ChainType.testBTC : ChainType.BTC, options);
   }
}
