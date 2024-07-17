import { WALLET } from "../../src";
import { ICreateWalletResponse } from "../../src/interfaces/WalletTransactionInterface";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);
import WAValidator from "wallet-address-validator";
import { BTC_DOGE_DEC_PLACES, DOGE_DUST_AMOUNT } from "../../src/utils/constants";
import { toBNExp } from "../../src/utils/bnutils";
import rewire from "rewire";
import { initializeMikroORM } from "../../src/orm/mikro-orm.config";
import { fetchTransactionEntityById } from "../../src/db/dbutils";
import { sleepMs } from "../../src/utils/utils";
import { TransactionStatus } from "../../src/entity/transaction";

const rewiredUTXOWalletImplementation = rewire("../../src/chain-clients/DogeWalletImplementation");
const rewiredUTXOWalletImplementationClass = rewiredUTXOWalletImplementation.__get__("DogeWalletImplementation");

const DOGEMccConnectionTest = {
   url: process.env.DOGE_URL ?? "",
   username: "",
   password: "",
   inTestnet: true,
   walletSecret: "wallet_secret"
};

const fundedMnemonic = "involve essay clean frequent stumble cheese elite custom athlete rack obey walk";
const fundedAddress = "noXb5PiT85PPyQ3WBMLY7BUExm9KpfV93S";
const targetMnemonic = "forum tissue lonely diamond sea invest hill bamboo hamster leaf asset column duck order sock dad beauty valid staff scan hospital pair law cable";
const targetAddress = "npJo8FieqEmB1NehU4jFFEFPsdvy8ippbm";
//old target, still holds some funds:
const address = 'nk1Uc5w6MHC1DgtRvnoQvCj3YgPemzha7D'
const privateKey = 'ckmubApfH515MCZNC9ufLR4kHrmnb1PCtX2vhoN4iYx9Wqzh2AQ9'


const DOGE_DECIMAL_PLACES = BTC_DOGE_DEC_PLACES;
const amountToSendInSatoshi = toBNExp(1.5, DOGE_DECIMAL_PLACES);
const feeInSatoshi = toBNExp(2, DOGE_DECIMAL_PLACES);
const maxFeeInSatoshi = toBNExp(1.5, DOGE_DECIMAL_PLACES);

let wClient: WALLET.DOGE;
let fundedWallet: ICreateWalletResponse;

describe("Dogecoin wallet tests", () => {
   before(async () => {
      wClient = await WALLET.DOGE.initialize(DOGEMccConnectionTest);
      void wClient.startMonitoringTransactionProgress()
   });

   after(function() {
      wClient.stopMonitoring();
   });


   it("Should create account", async () => {
      const newAccount = wClient.createWallet();
      expect(newAccount.address).to.not.be.null;

      fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
      expect(fundedWallet.address).to.eq(fundedAddress);
      const targetWallet = wClient.createWalletFromMnemonic(targetMnemonic);
      expect(targetWallet.address).to.eq(targetAddress);

      expect(WAValidator.validate(newAccount.address, "DOGE", "testnet")).to.be.true;
      expect(WAValidator.validate(fundedWallet.address, "DOGE", "testnet")).to.be.true;
      expect(WAValidator.validate(targetWallet.address, "DOGE", "testnet")).to.be.true;
   });

   it("Should prepare and execute transaction", async () => {
      fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
      const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
      const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, undefined, note, undefined);
      expect(id).to.be.gt(0);
      const startTime = Date.now();
      const timeLimit = 15 * 60_000; // 15 min s
      for (let i = 0; ; i++) {
         const tx = await fetchTransactionEntityById(wClient.orm, id);
         if (tx.status == TransactionStatus.TX_SUCCESS) {
            break;
         }
         if (Date.now() - startTime > timeLimit) {
            console.log(tx)
            throw new Error(`Time limit exceeded for ${tx.id} with ${tx.transactionHash}`);
         }
         wClient.orm.em.clear();
         await sleepMs(2000);
     }
   });

   // it("Should prepare and execute transactions", async () => {
   //    fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
   //    const note0 = "00000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
   //    const note1 = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
   //    const note2 = "20000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
   //    const resp0 = await wClient.prepareAndExecuteTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, undefined, note0);
   //    expect(typeof resp0).to.equal("object");
   //    const resp1 = await wClient.prepareAndExecuteTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, undefined, note1);
   //    expect(typeof resp1).to.equal("object");
   //    const resp2 = await wClient.prepareAndExecuteTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, undefined, note2);
   //    expect(typeof resp2).to.equal("object");
   // });

   it("Should not submit transaction: fee > maxFee", async () => {
      fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
      const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, feeInSatoshi, "Submit", maxFeeInSatoshi);
      expect(id).to.be.gt(0);
      const startTime = Date.now();
      const timeLimit = 30_000; // 30 s
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

   //TODO fix
   it.skip("Should not create transaction: amount = dust amount", async () => {
      const rewired = new rewiredUTXOWalletImplementationClass(DOGEMccConnectionTest);
      rewired.orm = await initializeMikroORM();
      fundedWallet = rewired.createWalletFromMnemonic(fundedMnemonic);
      await expect(rewired.preparePaymentTransaction(fundedWallet.address, targetAddress, DOGE_DUST_AMOUNT, feeInSatoshi, "Note", maxFeeInSatoshi)).to
         .eventually.be.rejectedWith(`Will not prepare transaction for ${fundedWallet.address}. Amount ${DOGE_DUST_AMOUNT.toString()} is less than dust ${DOGE_DUST_AMOUNT.toString()}`);
   });

   it("Should receive fee", async () => {
      const fee = await wClient.getCurrentTransactionFee({source: fundedAddress, amount: amountToSendInSatoshi, destination: targetAddress});
      expect(fee).not.to.be.null;
   });

   it("Should receive latest blockHeight", async () => {
      const index = await wClient.getCurrentBlockHeight();
      expect(index).not.to.be.null;
   });

   it("Should delete account", async () => {
      const targetWallet = wClient.createWalletFromMnemonic(targetMnemonic);
      const balance = await wClient.getAccountBalance(targetWallet.address);
      // delete toDelete account
      const note = "dead0000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
      const id = await wClient.createDeleteAccountTransaction(targetWallet.address, targetWallet.privateKey, fundedAddress, undefined, note);
      const startTime2 = Date.now();
      const timeLimit2 = 15 * 60000 // 15min
      while (1) {
         const tx = await fetchTransactionEntityById(wClient.orm, id);
         if (tx.status == TransactionStatus.TX_SUCCESS) {
            break;
         }
         if (Date.now() - startTime2 > timeLimit2) {
            throw new Error(`Time limit 2 exceeded in for transaction ${tx.id, tx.transactionHash}`);
          }
         wClient.orm.em.clear();
         await sleepMs(2000);
      }
      const balance2 = await wClient.getAccountBalance(targetWallet.address);
      expect(balance.gt(balance2));
   });

});
