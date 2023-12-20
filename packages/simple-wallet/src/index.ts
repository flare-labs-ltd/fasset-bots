import { AlgoWalletImplementation } from "./chain-clients/AlgoWalletImplementation";
import { BtcWalletImplementation } from "./chain-clients/BtcWalletImplementation";
import { DogeWalletImplementation } from "./chain-clients/DogeWalletImplementation";
import { LtcWalletImplementation } from "./chain-clients/LtcWalletImplementation";
import { XrpWalletImplementation } from "./chain-clients/XrpWalletImplementation";
import type { AlgoRpcConfig, BaseRpcConfig } from "./interfaces/WriteWalletRpcInterface";

export type { WalletClient, WalletCreate } from "./types";

export module WALLET {
   export class XRP extends XrpWalletImplementation {
      constructor(options: BaseRpcConfig) {
         super(options);
      }
   }

   export class ALGO extends AlgoWalletImplementation {
      constructor(options: AlgoRpcConfig) {
         super(options);
      }
   }

   export class LTC extends LtcWalletImplementation {
      constructor(options: BaseRpcConfig) {
         super(options);
      }
   }

   export class BTC extends BtcWalletImplementation {
      constructor(options: BaseRpcConfig) {
         super(options);
      }
   }

   export class DOGE extends DogeWalletImplementation {
      constructor(options: BaseRpcConfig) {
         super(options);
      }
   }
}
