import { BtcWalletImplementation } from "./chain-clients/BtcWalletImplementation";
import { DogeWalletImplementation } from "./chain-clients/DogeWalletImplementation";
import { XrpWalletImplementation } from "./chain-clients/XrpWalletImplementation";
import { BtcAccountGeneration } from "./chain-clients/account-generation/BtcAccountGeneration";
import { DogeAccountGeneration } from "./chain-clients/account-generation/DogeAccountGeneration";
import { XrpAccountGeneration } from "./chain-clients/account-generation/XrpAccountGeneration";
import type { BitcoinWalletConfig, DogecoinWalletConfig, RippleWalletConfig } from "./interfaces/WalletTransactionInterface";

export type { WalletClient, WalletCreate } from "./types";
export type { StuckTransaction } from "./interfaces/WalletTransactionInterface";

export module WALLET {

   export class XrpAccount extends XrpAccountGeneration {
      constructor(inTestnet: boolean){
         super(inTestnet);
      }
   }
   export class BtcAccount extends BtcAccountGeneration {
      constructor(inTestnet: boolean){
         super(inTestnet);
      }
   }

   export class DogeAccount extends DogeAccountGeneration {
      constructor(inTestnet: boolean){
         super(inTestnet);
      }
   }
   export class XRP extends XrpWalletImplementation {
      constructor(options: RippleWalletConfig) {
         super(options);
      }
      static async initialize(createConfig: RippleWalletConfig) {
         const wallet = new XrpWalletImplementation(createConfig);
         return wallet;
      }
   }

   export class BTC extends BtcWalletImplementation {
      constructor(options: BitcoinWalletConfig) {
         super(options);
      }
      static async initialize(createConfig: BitcoinWalletConfig) {
         const wallet = new BtcWalletImplementation(createConfig);
         return wallet;
      }
   }

   export class DOGE extends DogeWalletImplementation {
      constructor(options: DogecoinWalletConfig) {
         super(options);
      }
      static async initialize(createConfig: DogecoinWalletConfig) {
         const wallet = new DogeWalletImplementation(createConfig);
         return wallet;
      }
   }
}
