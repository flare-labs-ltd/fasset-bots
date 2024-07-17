import { WALLET } from "../../src";
import { ICreateWalletResponse, RippleWalletConfig } from "../../src/interfaces/WalletTransactionInterface";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);
import WAValidator from "wallet-address-validator";
import rewire from "rewire";
import { XRP_DECIMAL_PLACES } from "../../src/utils/constants";
import { toBN, toBNExp } from "../../src/utils/bnutils";
import { fetchTransactionEntityById } from "../../src/db/dbutils";
import { sleepMs } from "../../src/utils/utils";
import { TransactionStatus } from "../../src/entity/transaction";

const rewiredXrpWalletImplementation = rewire("../../src/chain-clients/XrpWalletImplementation");
const rewiredXrpWalletImplementationClass = rewiredXrpWalletImplementation.__get__("XrpWalletImplementation");
const walletSecret = "secret_address"

const XRPMccConnectionTest: RippleWalletConfig = {
   url: process.env.XRP_URL ?? "",
   username: "",
   password: "",
   stuckTransactionOptions: {
      blockOffset: 10,
      retries: 2,
   },
   rateLimitOptions: {
      timeoutMs: 60000,
   },
   walletSecret: walletSecret,
   inTestnet: true
};

const fundedSeed = "sannPkA1sGXzM1MzEZBjrE1TDj4Fr";
const fundedAddress = "rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8";
const targetMnemonic = "involve essay clean frequent stumble cheese elite custom athlete rack obey walk";
const targetAddress = "r4CrUeY9zcd4TpndxU5Qw9pVXfobAXFWqq";
const entropyBase = "my_xrp_test_wallet";
const entropyBasedAddress = "rMeXpc8eokNRCTVtCMjFqTKdyRezkYJAi1";

const amountToSendDropsFirst = toBNExp(0.1, XRP_DECIMAL_PLACES);
const amountToSendDropsSecond = toBNExp(0.05, XRP_DECIMAL_PLACES);
const feeInDrops = toBNExp(0.000015, 6);
const maxFeeInDrops = toBNExp(0.000012, 6);
const sequence = 54321;

let wClient: WALLET.XRP;
let fundedWallet: ICreateWalletResponse; //testnet, seed: sannPkA1sGXzM1MzEZBjrE1TDj4Fr, account: rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8

describe("Xrp wallet tests", () => {
   before(async () => {
      wClient = await WALLET.XRP.initialize(XRPMccConnectionTest);
      void wClient.startMonitoringTransactionProgress();
   });

   after(function() {
      wClient.stopMonitoring();
    });

   it("Should create account", async () => {
      const newAccount = wClient.createWallet();
      expect(newAccount.address).to.not.be.null;
      const targetAccount = wClient.createWalletFromMnemonic(targetMnemonic);
      expect(targetAccount.address).to.equal(targetAddress);

      expect(WAValidator.validate(newAccount.address, "XRP", "testnet")).to.be.true;
      expect(WAValidator.validate(targetAccount.address, "XRP", "testnet")).to.be.true;
   });

   it("Should create account 2", async () => {
      const newAccount = wClient.createWalletFromEntropy(Buffer.from(entropyBase), "ecdsa-secp256k1");
      expect(newAccount.address).to.equal(entropyBasedAddress);
      expect(WAValidator.validate(newAccount.address, "XRP", "testnet")).to.be.true;
   });

   it("Should create account 3", async () => {
      fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
      expect(fundedWallet.address).to.equal(fundedAddress);
      expect(WAValidator.validate(fundedWallet.address, "XRP", "testnet")).to.be.true;
   });

   it("Should get public key from private key", async () => {
      const seed0 = "sh8N3CZNMqdjBhgsbdzp8NoEnr8MH";
      const seed1 = "sEdTcEtUFE7BxDKj5QfdgyGorRKmq73";
      const wallet0 = wClient.createWalletFromSeed(seed0, "ecdsa-secp256k1");
      const wallet1 = wClient.createWalletFromSeed(seed1, "ed25519");

      const rewired = new rewiredXrpWalletImplementationClass(XRPMccConnectionTest);
      const public0 = rewired.getPublicKeyFromPrivateKey(wallet0.privateKey, wallet0.address);
      const public1 = rewired.getPublicKeyFromPrivateKey(wallet1.privateKey, wallet1.address);
      expect(wallet0.publicKey).to.eq(public0);
      expect(wallet1.publicKey).to.eq(public1);
   });

   it("Should submit transaction", async () => {
      fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
      const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
      const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendDropsFirst, undefined, note, undefined);
      expect(id).to.be.gt(0);
      const startTime = Date.now();
      const timeLimit = 20000; // 20 s
      for (let i = 0; ; i++) {
         const tx = await fetchTransactionEntityById(wClient.orm, id);
         if (tx.status == TransactionStatus.TX_SUCCESS) {
            break;
         }
         if (Date.now() - startTime > timeLimit) {
            throw new Error(`Time limit exceeded for ${tx.id} with ${tx.transactionHash}`);
         }
         wClient.orm.em.clear();
         await sleepMs(2000);
     }
   });

   it("Should not validate submit and resubmit transaction - fee to low", async () => {
      fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
      const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
      const lowFee = toBN(1);
      const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendDropsFirst, lowFee, note);
      expect(id).to.be.gt(0);
      const startTime = Date.now();
      const timeLimit = 40000; // 40 s
      let replacedTx = null;
      while(1) {
         const txInfo = await wClient.getTransactionInfo(id);
         if (txInfo.replacedByDdId) {
            replacedTx = await fetchTransactionEntityById(wClient.orm, txInfo.replacedByDdId);
         }
         if (replacedTx && replacedTx.status == TransactionStatus.TX_FAILED) {
            break;
         }
         if (Date.now() - startTime > timeLimit) {
            throw new Error(`Time limit exceeded for ${txInfo.dbId} with ${txInfo.transactionHash}`);
         }
         wClient.orm.em.clear();
         await sleepMs(2000);
      }
      const tx = await fetchTransactionEntityById(wClient.orm, id);
      expect(tx.status).to.equal(TransactionStatus.TX_REPLACED);
   });

   it("Should create transaction with fee", async () => {
      fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
      const note = "Submit";
      const trId = await wClient.createPaymentTransaction(
         fundedWallet.address,
         fundedWallet.privateKey,
         targetAddress,
         amountToSendDropsSecond,
         feeInDrops,
         note,
         undefined,
      );
      const txEnt = await fetchTransactionEntityById(wClient.orm, trId);
      expect(txEnt.source).to.equal(fundedWallet.address);
      expect(txEnt.destination).to.equal(targetAddress);
      expect(txEnt.fee?.toString()).to.equal(feeInDrops.toString());
      expect(txEnt.reference).to.equal(note);
      const startTime = Date.now();
      const timeLimit = 30000; // 30 s
      for (let i = 0; ; i++) {
         const tx = await fetchTransactionEntityById(wClient.orm, txEnt.id);
         if (tx.status == TransactionStatus.TX_SUCCESS) {
            break;
         }
         if (Date.now() - startTime > timeLimit) {
            throw new Error(`Time limit exceeded for ${tx.id} with ${tx.transactionHash}`);
         }
         wClient.orm.em.clear();
         await sleepMs(2000);
      }
   });

   it("Should not submit transaction: fee > maxFee", async () => {
      fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
      const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendDropsSecond, feeInDrops, "Submit", maxFeeInDrops);
      expect(id).to.be.gt(0);
      const startTime = Date.now();
      const timeLimit = 30000; // 30 s
      for (let i = 0; ; i++) {
         const tx = await fetchTransactionEntityById(wClient.orm, id);
         if (tx.status == TransactionStatus.TX_FAILED) {
            break;
         }
         if (Date.now() - startTime > timeLimit) {
            throw new Error(`Time limit exceeded for ${tx.id} with ${tx.transactionHash}`);
         }
         wClient.orm.em.clear();
         await sleepMs(2000);
     }
     const txEnt = await fetchTransactionEntityById(wClient.orm, id);
     expect(txEnt.maxFee!.lt(txEnt.fee!)).to.be.true;
   });

   it("Should receive fee", async () => {
      const feeP = await wClient.getCurrentTransactionFee({ isPayment: true });
      expect(feeP).not.to.be.null;
      const fee = await wClient.getCurrentTransactionFee({ isPayment: false });
      expect(fee).not.to.be.null;
      expect(fee.gt(feeP)).to.be.true;
   });

   it("Should receive latest validated ledger index", async () => {
      const index = await wClient.getLatestValidatedLedgerIndex();
      expect(index).not.to.be.null;
   });

   it("Should not submit resubmitted transaction - fee to low", async () => {
      fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
      const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
      const lowFee = toBN(2);
      const maxFee = toBN(3);
      const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendDropsFirst, lowFee, note, maxFee);
      expect(id).to.be.gt(0);
      const startTime = Date.now();
      const timeLimit = 40000; // 40 s
      while(1) {
         const tx = await fetchTransactionEntityById(wClient.orm, id);
         if (tx.status == TransactionStatus.TX_FAILED) {
            break;
         }
         if (Date.now() - startTime > timeLimit) {
            throw new Error(`Time limit exceeded for ${tx.id} with ${tx.transactionHash}`);
         }
         wClient.orm.em.clear();
         await sleepMs(2000);
      }
      const tx = await wClient.getTransactionInfo(id);
      expect(tx.replacedByDdId).to.be.null;
      const txEnt = await fetchTransactionEntityById(wClient.orm, id);
     expect(txEnt.maxFee!.lt(txEnt.fee!.muln(wClient.feeIncrease))).to.be.true;
   });

   // Running this takes cca 20 min, as account can only be deleted
   // if account sequence + DELETE_ACCOUNT_OFFSET < ledger number
   it.skip("Should create and delete account", async () => {
      const toDelete = wClient.createWallet();
      expect(toDelete.address).to.not.be.null;
      expect(WAValidator.validate(toDelete.address, "XRP", "testnet")).to.be.true;
      fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
      expect(WAValidator.validate(fundedWallet.address, "XRP", "testnet")).to.be.true;
      const toSendInDrops = toBNExp(20,6); // 20 XPR
      // fund toDelete account
      const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, toDelete.address, toSendInDrops);
      const startTime = Date.now();
      const timeLimit = 30000; // 30 s
      while (1) {
         const tx = await fetchTransactionEntityById(wClient.orm, id);
         if (tx.status == TransactionStatus.TX_SUCCESS) {
            break;
         }
         if (Date.now() - startTime > timeLimit) {
            throw new Error(`Time limit 1 exceeded for transaction ${tx.id, tx.transactionHash}`);
          }
         wClient.orm.em.clear();
         await sleepMs(2000);
      }
      const balance = await wClient.getAccountBalance(toDelete.address);
      // delete toDelete account
      const id2 = await wClient.createDeleteAccountTransaction(toDelete.address, toDelete.privateKey, fundedWallet.address);
      const startTime2 = Date.now();
      const timeLimit2 = 25 * 60000 // 25min
      while (1) {
         const tx = await fetchTransactionEntityById(wClient.orm, id2);
         if (tx.status == TransactionStatus.TX_SUCCESS) {
            break;
         }
         if (Date.now() - startTime2 > timeLimit2) {
            throw new Error(`Time limit 2 exceeded in for transaction ${tx.id, tx.transactionHash}`);
          }
         wClient.orm.em.clear();
         await sleepMs(2000);
      }
      const balance2 = await wClient.getAccountBalance(toDelete.address);
      expect(balance.gt(balance2));
   });
});
