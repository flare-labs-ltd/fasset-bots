import { UTXOWalletImplementation } from "./UTXOWalletImplementation";
import { ChainType } from "../utils/constants";
import type { DogecoinWalletConfig } from "../interfaces/IWalletTransaction";

export class DogeWalletImplementation extends UTXOWalletImplementation {
   constructor(options: DogecoinWalletConfig) {
      super(options.inTestnet ? ChainType.testDOGE : ChainType.DOGE, options);
   }
}
