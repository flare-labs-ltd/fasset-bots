import { UTXOWalletImplementation } from "./UTXOWalletImplementation";
import { ChainType } from "../../utils/constants";
import type { DogecoinWalletConfig } from "../../interfaces/IWalletTransaction";
import { EntityManager } from "@mikro-orm/core";
import { logger } from "../../utils/logger";
import { BlockchainFeeService } from "../../fee-service/fee-service";

export class DogeWalletImplementation extends UTXOWalletImplementation {
   constructor(options: DogecoinWalletConfig, monitoringId: string | null, feeService: BlockchainFeeService | null) {
      const chainType = options.inTestnet ? ChainType.testDOGE : ChainType.DOGE;
      super(chainType, options, monitoringId, feeService);
   }

   clone(monitoringId: string, rootEm: EntityManager): UTXOWalletImplementation {
      logger.info(`Forking wallet ${this.monitoringId} to ${monitoringId}`);
      return new DogeWalletImplementation({ ...this.createConfig, em: rootEm }, monitoringId, this.feeService);
   }
}
