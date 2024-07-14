import { BtcWalletImplementation } from "./chain-clients/BtcWalletImplementation";
import { DogeWalletImplementation } from "./chain-clients/DogeWalletImplementation";
import { XrpWalletImplementation } from "./chain-clients/XrpWalletImplementation";
import { DBWalletKeys } from "./db/wallet";
import type { BitcoinWalletConfig, DogecoinWalletConfig, RippleWalletConfig } from "./interfaces/WriteWalletInterface";
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
         wallet.orm = await initializeMikroORM();
         wallet.walletKeys = new DBWalletKeys(wallet.orm.em, createConfig.walletSecret);
         return wallet;
      }
   }

   export class BTC extends BtcWalletImplementation {
      constructor(options: BitcoinWalletConfig) {
         super(options);
      }
      static async initialize(createConfig: BitcoinWalletConfig) {
         const wallet = new BtcWalletImplementation(createConfig);
         wallet.orm = await initializeMikroORM();
         wallet.walletKeys = new DBWalletKeys(wallet.orm.em, createConfig.walletSecret);
         return wallet;
      }
   }

   export class DOGE extends DogeWalletImplementation {
      constructor(options: DogecoinWalletConfig) {
         super(options);
      }
      static async initialize(createConfig: DogecoinWalletConfig) {
         const wallet = new DogeWalletImplementation(createConfig);
         wallet.orm = await initializeMikroORM();
         wallet.walletKeys = new DBWalletKeys(wallet.orm.em, createConfig.walletSecret);
         return wallet;
      }
   }
}
