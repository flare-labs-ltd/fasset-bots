import { Wallet as xrplWallet } from "xrpl"; // package has some member access issues
// eslint-disable-next-line @typescript-eslint/no-var-requires
const xrpl__typeless = require("xrpl");
import { generateMnemonic } from "bip39";
import { ICreateWalletResponse, WalletAccountGenerationInterface } from "../../interfaces/IWalletTransaction";
import { ChainType, MNEMONIC_STRENGTH } from "../../utils/constants";


export class XrpAccountGeneration implements WalletAccountGenerationInterface {
    chainType: ChainType;

    constructor(inTestnet: boolean) {
        this.chainType = inTestnet ? ChainType.testXRP : ChainType.XRP;
    }

   /**
    * @returns {Object} - wallet with auto generated mnemonic
    */
   createWallet(): ICreateWalletResponse {
      const mnemonic = generateMnemonic(MNEMONIC_STRENGTH);
      const resp = xrplWallet.fromMnemonic(mnemonic);
      return {
         privateKey: resp.privateKey,
         publicKey: resp.publicKey,
         address: resp.classicAddress,
         mnemonic: mnemonic,
      } as ICreateWalletResponse;
   }

   /**
    * @param {string} mnemonic - mnemonic used for wallet creation
    * @returns {Object} - wallet generated using mnemonic from input
    */
   createWalletFromMnemonic(mnemonic: string): ICreateWalletResponse {
      const resp = xrplWallet.fromMnemonic(mnemonic);
      return {
         privateKey: resp.privateKey,
         publicKey: resp.publicKey,
         address: resp.classicAddress,
         mnemonic: mnemonic,
      } as ICreateWalletResponse;
   }
}
