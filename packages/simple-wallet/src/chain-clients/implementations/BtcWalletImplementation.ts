import { UTXOWalletImplementation } from "./UTXOWalletImplementation";
import { ChainType } from "../../utils/constants";
import type { BitcoinWalletConfig } from "../../interfaces/IWalletTransaction";
import { EntityManager } from "@mikro-orm/core";
import { logger } from "../../utils/logger";
import { BlockchainFeeService } from "../../fee-service/fee-service";

export class BtcWalletImplementation extends UTXOWalletImplementation {
   constructor(options: BitcoinWalletConfig, monitoringId: string | null, feeService: BlockchainFeeService | null) {
      const chainType = options.inTestnet ? ChainType.testBTC : ChainType.BTC;
      super(chainType, options, monitoringId, feeService);
   }

   clone(monitoringId: string, rootEm: EntityManager): UTXOWalletImplementation {
      logger.info(`Forking wallet ${this.monitoringId} to ${monitoringId}`);
      return new BtcWalletImplementation({ ...this.createConfig, em: rootEm }, monitoringId, this.feeService);
   }
}
