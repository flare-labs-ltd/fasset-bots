import { BtcishWalletImplementation } from "./BtcishWalletImplementation";
import { ChainType } from "../utils/constants";
import type { DogecoinRpcConfig } from "../interfaces/WriteWalletRpcInterface";

export class DogeWalletImplementation extends BtcishWalletImplementation {
   constructor(options: DogecoinRpcConfig) {
      super(options.inTestnet ? ChainType.testDOGE : ChainType.DOGE, options);
   }
}
