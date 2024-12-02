import { UTXOWalletImplementation } from "./UTXOWalletImplementation";
import { ChainType } from "../../utils/constants";
import type { DogecoinWalletConfig } from "../../interfaces/IWalletTransaction";
import { logger } from "../../utils/logger";
import { CreateWalletOverrides } from "../monitoring/TransactionMonitor";

export class DogeWalletImplementation extends UTXOWalletImplementation {
   constructor(options: DogecoinWalletConfig, overrides: CreateWalletOverrides) {
      const chainType = options.inTestnet ? ChainType.testDOGE : ChainType.DOGE;
      super(chainType, options, overrides);
   }

   clone(overrides: CreateWalletOverrides): UTXOWalletImplementation {
      logger.info(`Forking wallet ${this.monitoringId} to ${overrides.monitoringId}`);
      return new DogeWalletImplementation(this.createConfig, overrides);
   }
}
