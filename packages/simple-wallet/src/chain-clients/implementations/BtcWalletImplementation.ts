import { UTXOWalletImplementation } from "./UTXOWalletImplementation";
import { ChainType } from "../../utils/constants";
import type { BitcoinWalletConfig } from "../../interfaces/IWalletTransaction";
import { logger } from "../../utils/logger";
import { CreateWalletOverrides } from "../monitoring/TransactionMonitor";

export class BtcWalletImplementation extends UTXOWalletImplementation {
   constructor(options: BitcoinWalletConfig, overrides: CreateWalletOverrides) {
      const chainType = options.inTestnet ? ChainType.testBTC : ChainType.BTC;
      super(chainType, options, overrides);
   }

   override clone(overrides: CreateWalletOverrides): UTXOWalletImplementation {
      logger.info(`Forking wallet ${this.monitoringId} to ${overrides.monitoringId}`);
      return new BtcWalletImplementation(this.createConfig, overrides);
   }
}
