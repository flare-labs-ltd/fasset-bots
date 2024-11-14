import { UTXOWalletImplementation } from "./UTXOWalletImplementation";
import { ChainType } from "../../utils/constants";
import type { DogecoinWalletConfig } from "../../interfaces/IWalletTransaction";
import { EntityManager } from "@mikro-orm/core";

export class DogeWalletImplementation extends UTXOWalletImplementation {
   constructor(monitoringId: string | null, options: DogecoinWalletConfig) {
      const chainType = options.inTestnet ? ChainType.testDOGE : ChainType.DOGE;
      super(chainType, monitoringId, options);
   }

   clone(monitoringId: string, rootEm: EntityManager): UTXOWalletImplementation {
      return new DogeWalletImplementation(monitoringId, { ...this.createConfig, em: rootEm });
   }
}
