import { UTXOWalletImplementation } from "./UTXOWalletImplementation";
import { ChainType } from "../../utils/constants";
import type { BitcoinWalletConfig } from "../../interfaces/IWalletTransaction";
import { EntityManager } from "@mikro-orm/core";

export class BtcWalletImplementation extends UTXOWalletImplementation {
   constructor(monitoringId: string | null, options: BitcoinWalletConfig) {
      const chainType = options.inTestnet ? ChainType.testBTC : ChainType.BTC;
      super(chainType, monitoringId, options);
   }

   clone(monitoringId: string, rootEm: EntityManager): UTXOWalletImplementation {
      return new BtcWalletImplementation(monitoringId, { ...this.createConfig, em: rootEm });
   }
}
