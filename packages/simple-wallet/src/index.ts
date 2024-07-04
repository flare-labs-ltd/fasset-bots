import { AlgoWalletImplementation } from "./chain-clients/AlgoWalletImplementation";
import { BtcWalletImplementation } from "./chain-clients/BtcWalletImplementation";
import { DogeWalletImplementation } from "./chain-clients/DogeWalletImplementation";
import { LtcWalletImplementation } from "./chain-clients/LtcWalletImplementation";
import { XrpWalletImplementation } from "./chain-clients/XrpWalletImplementation";
import type { AlgoWalletConfig, BitcoinWalletConfig, DogecoinWalletConfig, LitecoinWalletConfig, RippleWalletConfig } from "./interfaces/WriteWalletInterface";
import { initializeMikroORM } from "./orm/mikro-orm.config";

export type { WalletClient, WalletCreate } from "./types";
export type { StuckTransaction } from "./interfaces/WriteWalletInterface";

export module WALLET {
   export class XRP extends XrpWalletImplementation {
      constructor(options: RippleWalletConfig) {
         super(options);
      }
      static async initialize(createConfig: RippleWalletConfig) {
         const wallet = new XrpWalletImplementation(createConfig);
         wallet.orm = await initializeMikroORM("simple-wallet_xrp.db");
         return wallet;
      }
   }

   export class ALGO extends AlgoWalletImplementation {
      constructor(options: AlgoWalletConfig) {
         super(options);
      }
      static async initialize(createConfig: AlgoWalletConfig) {
         const wallet = new AlgoWalletImplementation(createConfig);
         wallet.orm = await initializeMikroORM("simple-wallet_algo.db");
         return wallet;
      }
   }

   export class LTC extends LtcWalletImplementation {
      constructor(options: LitecoinWalletConfig) {
         super(options);
      }
      static async initialize(createConfig: LitecoinWalletConfig) {
         const wallet = new LtcWalletImplementation(createConfig);
         wallet.orm = await initializeMikroORM("simple-wallet_ltc.db");
         return wallet;
      }
   }

   export class BTC extends BtcWalletImplementation {
      constructor(options: BitcoinWalletConfig) {
         super(options);
      }
      static async initialize(createConfig: BitcoinWalletConfig) {
         const wallet = new BtcWalletImplementation(createConfig);
         wallet.orm = await initializeMikroORM("simple-wallet_btc.db");
         return wallet;
      }
   }

   export class DOGE extends DogeWalletImplementation {
      constructor(options: DogecoinWalletConfig) {
         super(options);
      }
      static async initialize(createConfig: DogecoinWalletConfig) {
         const wallet = new DogeWalletImplementation(createConfig);
         wallet.orm = await initializeMikroORM("simple-wallet_doge.db");
         return wallet;
      }
   }
}
