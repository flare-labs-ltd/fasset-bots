import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import elliptic from "elliptic";
import xrpl, { convertStringToHex, encodeForSigning, Wallet as xrplWallet, encode as xrplEncode, hashes as xrplHashes } from "xrpl"; // package has some member access issues
// eslint-disable-next-line @typescript-eslint/no-var-requires
const xrpl__typeless = require("xrpl");
import { deriveAddress, sign } from "ripple-keypairs";
import { generateMnemonic } from "bip39";
import { excludeNullFields, sleepMs, bytesToHex, isValidHex, prefix0x, xrp_ensure_data, toBN, getTimeLockForAddress, stuckTransactionConstants } from "../utils/utils";
import {
   ChainType,
   DEFAULT_RATE_LIMIT_OPTIONS_XRP,
   XRP_LEDGER_CLOSE_TIME_MS,
} from "../utils/constants";
import type { AccountInfoRequest, AccountInfoResponse } from "xrpl";
import type { ISubmitTransactionResponse, ICreateWalletResponse, WriteWalletRpcInterface, RippleRpcConfig } from "../interfaces/WriteWalletRpcInterface";
import BN from "bn.js";

const ed25519 = new elliptic.eddsa("ed25519");
const secp256k1 = new elliptic.ec("secp256k1");

const DROPS_PER_XRP = 1000000.0

export class XrpWalletImplementation implements WriteWalletRpcInterface {
   chainType: ChainType;
   inTestnet: boolean;
   client: AxiosInstance;
   addressLocks = new Map<string, { tx: xrpl.Payment | null; maxFee: BN | null }>();
   blockOffset: number;
   timeoutAddressLock: number;
   maxRetries: number;
   feeIncrease: number;
   lastResortFeeInDrops: number;

   constructor(createConfig: RippleRpcConfig) {
      this.inTestnet = createConfig.inTestnet ?? false;
      this.chainType = this.inTestnet ? ChainType.testXRP : ChainType.XRP;

      const createAxiosConfig: AxiosRequestConfig = {
         baseURL: createConfig.url,
         headers: excludeNullFields({
            "Content-Type": "application/json",
            "x-apikey": createConfig.apiTokenKey,
         }),
         auth:
            createConfig.username && createConfig.password
               ? {
                  username: createConfig.username,
                  password: createConfig.password,
               }
               : undefined,
         timeout: createConfig.rateLimitOptions?.timeoutMs ?? DEFAULT_RATE_LIMIT_OPTIONS_XRP.timeoutMs,
         validateStatus: function (status: number) {
            /* istanbul ignore next */
            return (status >= 200 && status < 300) || status == 500;
         },
      };
      // don't need rpc auth as we are always sending signed transactions
      const client = axios.create(createAxiosConfig);
      this.client = axiosRateLimit(client, {
         ...DEFAULT_RATE_LIMIT_OPTIONS_XRP,
         ...createConfig.rateLimitOptions,
      });
      const resubmit = stuckTransactionConstants(this.chainType);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.blockOffset = createConfig.stuckTransactionOptions?.blockOffset ?? resubmit.blockOffset!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.maxRetries = createConfig.stuckTransactionOptions?.retries ?? resubmit.retries!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.feeIncrease = createConfig.stuckTransactionOptions?.feeIncrease ?? resubmit.feeIncrease!;
      this.lastResortFeeInDrops = createConfig.stuckTransactionOptions?.lastResortFee ?? resubmit.lastResortFee!;
      this.timeoutAddressLock = getTimeLockForAddress(this.chainType, this.blockOffset, this.maxRetries);
   }

   /**
    * @returns {Object} - wallet with auto generated mnemonic
    */
   createWallet(): ICreateWalletResponse {
      const mnemonic = generateMnemonic();
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

   /**
    * @param {string} account
    * @returns {BN} - balance in drops
    */
   async getAccountBalance(account: string): Promise<BN> {
      const data = await this.getAccountInfo(account);
      return toBN(data.result.account_data.Balance);
   }

   /**
    * @returns {BN} - current transaction/network fee in drops
    */
   async getCurrentTransactionFee(): Promise<BN> {
      //https://xrpl.org/transaction-cost.html#server_info
      const serverInfo = (await this.getServerInfo()).result.info;
      /* istanbul ignore next */
      let baseFee = serverInfo.validated_ledger?.base_fee_xrp;
      /* istanbul ignore if */
      if (!baseFee) {
         throw Error("Could not get base_fee_xrp from server_info");
      }
      /* istanbul ignore next */
      if (serverInfo.load_factor) {
         baseFee *= serverInfo.load_factor;
      }
      return toBN(xrpl__typeless.xrpToDrops(this.roundUpXrpToDrops(baseFee)));
   }

   /**
    * @param {string} source
    * @param {string} destination
    * @param {BN} amountInDrops
    * @param {BN|undefined} feeInDrops - automatically set if undefined
    * @param {string|undefined} note
    * @param {BN|undefined} maxFeeInDrops
    * @param {number|undefined} sequence
    * @returns {Object} - XRP payment transaction object
    */
   async preparePaymentTransaction(
      source: string,
      destination: string,
      amountInDrops: BN,
      feeInDrops?: BN,
      note?: string,
      maxFeeInDrops?: BN,
      sequence?: number
   ): Promise<xrpl.Payment> {
      const tr: xrpl.Payment = {
         TransactionType: "Payment",
         Destination: destination.toString(),
         Amount: amountInDrops.toString(),
         Account: source,
      };
      if (!sequence) {
         tr.Sequence = await this.getAccountSequence(source);
      } else {
         tr.Sequence = sequence;
      }
      if (!feeInDrops) {
         tr.Fee = (await this.getCurrentTransactionFee()).toString();
      } else {
         tr.Fee = feeInDrops.toString();
      }
      this.checkFeeRestriction(toBN(tr.Fee), maxFeeInDrops);
      if (note) {
         const noteHex = isValidHex(prefix0x(note)) ? note : convertStringToHex(note);
         const Memo = { Memo: { MemoData: noteHex } };
         tr.Memos = [Memo];
      }
      // Highest ledger index this transaction can appear in. https://xrpl.org/reliable-transaction-submission.html#lastledgersequence
      tr.LastLedgerSequence = (await this.getLatestValidatedLedgerIndex()) + this.blockOffset;
      return tr;
   }

   /**
    * @param {Object} transaction
    * @param {string} privateKey
    * @returns {Object}
    */
   async signTransaction(transaction: xrpl.Transaction, privateKey: string): Promise<string> {
      const publicKey = this.getPublicKeyFromPrivateKey(privateKey, transaction.Account);
      const transactionToSign = { ...transaction };
      transactionToSign.SigningPubKey = publicKey;
      transactionToSign.TxnSignature = sign(encodeForSigning(transactionToSign), privateKey);
      const serialized = xrplEncode(transactionToSign);
      return serialized;
   }

   /**
    * @param {string} tx_blob
    * @returns {Object} - containing transaction id tx_id and optional result
    */
   async submitTransaction(tx_blob: string): Promise<ISubmitTransactionResponse> {
      const params = {
         tx_blob: tx_blob,
      };
      const res = await this.client.post("", {
         method: "submit",
         params: [params],
      });
      xrp_ensure_data(res.data);
      const txHash = xrplHashes.hashSignedTx(res.data.result.tx_blob);
      return { txId: txHash, result: res.data.result.engine_result };
   }

   /**
    * @param {string} source
    * @param {string} privateKey
    * @param {string} destination
    * @param {BN} amountInDrops
    * @param {BN|undefined} feeInDrops - automatically set if undefined
    * @param {string|undefined} note
    * @param {BN|undefined} maxFeeInDrops
    * @param {number|undefined} sequence
    * @returns {Object} - containing transaction id tx_id and optional result
    */
   async executeLockedSignedTransactionAndWait(
      source: string,
      privateKey: string,
      destination: string,
      amountInDrops: BN,
      feeInDrops?: BN,
      note?: string,
      maxFeeInDrops?: BN,
      sequence?: number
   ): Promise<ISubmitTransactionResponse> {
      await this.checkIfCanSubmitFromAddress(source);
      try {
         const transaction = await this.preparePaymentTransaction(source, destination, amountInDrops, feeInDrops, note, maxFeeInDrops, sequence);
         this.addressLocks.set(source, { tx: transaction, maxFee: maxFeeInDrops ? maxFeeInDrops : null });
         const tx_blob = await this.signTransaction(transaction, privateKey);
         const submitResp = await this.submitTransaction(tx_blob);
         // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
         return await this.waitForTransaction(submitResp.txId, submitResp.result!, source, privateKey);
      } finally {
         this.addressLocks.delete(source);
      }
   }

   ///////////////////////////////////////////////////////////////////////////////////////
   // HELPER OR CLIENT SPECIFIC FUNCTIONS ////////////////////////////////////////////////
   ///////////////////////////////////////////////////////////////////////////////////////

   /**
    * @returns {number} - ledger index of the latest validated ledger
    */
   async getLatestValidatedLedgerIndex(): Promise<number> {
      //https://xrpl.org/transaction-cost.html#server_info
      const serverInfo = (await this.getServerInfo()).result.info;
      /* istanbul ignore next */
      const ledgerIndex = serverInfo.validated_ledger?.seq;
      /* istanbul ignore if */
      if (!ledgerIndex) {
         throw Error("Could not get validated_ledger from server_info");
      }
      return ledgerIndex;
   }

   /**
    *
    * @param {string} privateKey
    * @returns {string} publicKey
    */
   private getPublicKeyFromPrivateKey(privateKey: string, address: string): string {
      /* secp256k1 */
      const secp256k1_privateKey = "00" + privateKey;
      const secp256k1_keypair = {
         privateKey: secp256k1_privateKey,
         publicKey: bytesToHex(secp256k1.keyFromPrivate(secp256k1_privateKey.slice(2)).getPublic().encodeCompressed()),
      };
      if (deriveAddress(secp256k1_keypair.publicKey) === address) return secp256k1_keypair.publicKey;

      /* ed25519 */
      const prefix = "ED";
      const ed25519_privateKey = privateKey.slice(2);
      const ed25519_keypair = {
         privateKey: prefix + ed25519_privateKey,
         publicKey: prefix + bytesToHex(ed25519.keyFromSecret(ed25519_privateKey).getPublic()),
      };
      return ed25519_keypair.publicKey;
   }

   /**
    * @param {string} seed - seed used for wallet creation
    * @param {string|undefined} algorithm
    * @returns {Object} - wallet
    */
   createWalletFromSeed(seed: string, algorithm?: "ed25519" | "ecdsa-secp256k1"): ICreateWalletResponse {
      return xrpl__typeless.Wallet.fromSeed(seed, { algorithm: algorithm });
   }

   /**
    * @param {string} entropy - entropy used for wallet creation
    * @param {string|undefined} algorithm
    * @returns {Object} - wallet
    */
   createWalletFromEntropy(entropy: Uint8Array, algorithm?: "ed25519" | "ecdsa-secp256k1"): ICreateWalletResponse {
      return xrpl__typeless.Wallet.fromEntropy(entropy, { algorithm: algorithm });
   }

   /**
    * @param {string} account
    * @returns {Object} - account info
    */
   async getAccountInfo(account: string): Promise<AccountInfoResponse> {
      const params = {
         account: account,
         signer_lists: true,
         ledger_index: "current",
      } as AccountInfoRequest;
      const res = await this.client.post("", {
         method: "account_info",
         params: [params],
      });
      xrp_ensure_data(res.data);
      return res.data;
   }

   /**
    * @returns {Object} - server info
    */
   async getServerInfo(): Promise<xrpl.ServerInfoResponse> {
      const res = await this.client.post("", {
         method: "server_info",
         params: [],
      });
      xrp_ensure_data(res.data);
      return res.data;
   }

   /**
    * @param {string} account
    * @returns {number} - account sequence
    */
   async getAccountSequence(account: string): Promise<number> {
      const data = await this.getAccountInfo(account);
      return data.result.account_data.Sequence;
   }

   /**
    * Returns transaction object when transaction is accepted to the ledger.
    * @param {string} txHash
    * @param {string} submissionResult
    * @param {string} source
    * @param {string} privateKey
    * @param {string} retry
    * @returns {Object} - containing transaction id tx_id and optional result
    */
   async waitForTransaction(
      txHash: string,
      submissionResult: string,
      source: string,
      privateKey: string,
      retry: number = 0
   ): Promise<ISubmitTransactionResponse> {
      await sleepMs(XRP_LEDGER_CLOSE_TIME_MS);
      const txResp = await this.client.post("", {
         method: "tx",
         params: [{ transaction: txHash }],
      });
      if (txResp.data.result.status === "error") {
         if (txResp.data.result.error === "txnNotFound") {
            return await this.tryToResubmitTransaction(txHash, submissionResult, source, privateKey, retry);
         }
         throw new Error(`waitForTransaction: ` + txResp.data.result.error + ` Submission result: ${submissionResult}.`);
      }
      if (txResp.data.result.validated) {
         // Transaction completed
         return { txId: txResp.data.result.hash };
      }
      return await this.tryToResubmitTransaction(txHash, submissionResult, source, privateKey, retry);
   }

   /**
    * Waits if previous transaction from address is still processing. If wait is too long it throws.
    * @param {string} address
    */
   async checkIfCanSubmitFromAddress(address: string): Promise<void> {
      const start = new Date().getTime();
      while (new Date().getTime() - start < this.timeoutAddressLock) {
         if (!this.addressLocks.has(address)) {
            this.addressLocks.set(address, { tx: null, maxFee: null });
            return;
         }
         await sleepMs(100);
      }
      throw new Error(`Timeout waiting to obtain confirmed transaction from address ${address}`);
   }

   /**
    * @param {string} txHash
    * @param {string} submissionResult
    * @param {Object} transaction
    * @param {number} retry
    * @param {string} privateKey
    * @returns {Object} - containing transaction id tx_id and optional result
    */
   async tryToResubmitTransaction(
      txHash: string,
      submissionResult: string,
      source: string,
      privateKey: string,
      retry: number
   ): Promise<ISubmitTransactionResponse> {
      const res = this.addressLocks.get(source);
      const transaction = res?.tx;
      if (!transaction) {
         throw new Error(`waitForTransaction: transaction ${txHash} for source ${source} cannot be found`);
      }
      const currentValidLedger = await this.getLatestValidatedLedgerIndex();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const lastBlockNumber = transaction.LastLedgerSequence!;
      if (currentValidLedger > lastBlockNumber) {
         if (retry <= this.maxRetries) {
            const newTransaction = transaction;
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const newFee = (retry < this.maxRetries)
               ? toBN(newTransaction.Fee!).muln(this.feeIncrease)
               : toBN(this.lastResortFeeInDrops);
            newTransaction.LastLedgerSequence = currentValidLedger + this.blockOffset;
            this.checkFeeRestriction(toBN(newFee), res.maxFee);
            newTransaction.Fee = newFee.toString();
            this.addressLocks.set(source, { tx: newTransaction, maxFee: res.maxFee });
            const blob = await this.signTransaction(newTransaction, privateKey);
            const submit = await this.submitTransaction(blob);
            retry++;
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            return this.waitForTransaction(submit.txId, submit.result!, source, privateKey, retry);
         }
         throw new Error(
            `waitForTransaction: transaction ${txHash} is not going to be accepted. Latest valid ledger ${currentValidLedger} is greater than transaction.LastLedgerSequence ${lastBlockNumber}`
         );
      }
      return this.waitForTransaction(txHash, submissionResult, source, privateKey, retry);
   }

   checkFeeRestriction(fee: BN, maxFee?: BN | null): void {
      if (maxFee && fee.gt(maxFee)) {
         throw Error(`Transaction is not prepared: fee ${fee} is higher than maxFee ${maxFee.toString()}`);
      }
   }

   private roundUpXrpToDrops(amount: number): number {
      return Math.ceil(amount * DROPS_PER_XRP) / DROPS_PER_XRP;
   }
}
