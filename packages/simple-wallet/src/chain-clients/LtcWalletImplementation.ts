import { BtcishWalletImplementation } from "./BtcishWalletImplementation";
import { ChainType } from "../utils/constants";
import type { LitecoinRpcConfig } from "../interfaces/WriteWalletRpcInterface";

export class LtcWalletImplementation extends BtcishWalletImplementation {
   constructor(options: LitecoinRpcConfig) {
      super(options.inTestnet ? ChainType.testLTC : ChainType.LTC, options);
   }
}
