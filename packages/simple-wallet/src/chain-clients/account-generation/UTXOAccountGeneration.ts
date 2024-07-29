
import { generateMnemonic } from "bip39";
import { ICreateWalletResponse, WalletAccountGenerationInterface } from "../../interfaces/WalletTransactionInterface";
import { ChainType, MNEMONIC_STRENGTH } from "../../utils/constants";
import { logger } from "../../utils/logger";
import * as bip84btc from "bip84";
import * as bip84doge from "dogecoin-bip84";

export class UTXOAccountGeneration implements WalletAccountGenerationInterface {

    constructor(
      public chainType: ChainType
    ) {
    }

   /**
    * @returns {Object} - wallet with auto generated mnemonic
    */
   createWallet(): ICreateWalletResponse {
      const mnemonic = generateMnemonic(MNEMONIC_STRENGTH);
      return this.createWalletFromMnemonic(mnemonic);
   }

   /**
    * @param {string} mnemonic - mnemonic used for wallet creation
    * @returns {Object} - wallet
    */
   createWalletFromMnemonic(mnemonic: string): ICreateWalletResponse {
      const bip84 = this.getBip84();
      const inTestnet = this.chainType == ChainType.testDOGE || this.chainType == ChainType.testBTC;
      const root = new bip84.fromMnemonic(mnemonic, "", inTestnet);
      const child00 = root.deriveAccount(0);
      const account0 = new bip84.fromZPrv(child00);
      let account;
      if (this.chainType == ChainType.testDOGE || this.chainType == ChainType.DOGE) {
         account = account0.getAddress(0, false, 44);
      } else if (this.chainType == ChainType.testBTC || this.chainType == ChainType.BTC) {
         account = account0.getAddress(0, false);

         console.log("xpub: ", account0.getAccountPublicKey())
      } else {
         logger.error(`Invalid chainType ${this.chainType}`);
         throw new Error(`Invalid chainType ${this.chainType}`);
      }
      return {
         address: account as string,
         mnemonic: mnemonic,
         privateKey: account0.getPrivateKey(0),
      };
   }

   private getBip84(): typeof bip84btc {
      if (this.chainType === ChainType.DOGE || this.chainType === ChainType.testDOGE) {
         return bip84doge;
      } else {
         return bip84btc;
      }
   }
}
