import { WALLET } from "../../src";
import { ICreateWalletResponse } from "../../src/interfaces/WriteWalletRpcInterface";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);
import WAValidator from "wallet-address-validator";
import { toBNExp } from "@flarelabs/fasset-bots-core/utils";
import { BTC_LTC_DOGE_DEC_PLACES } from "../../src/utils/constants";
const DOGEMccConnectionTest = {
   url: process.env.DOGE_URL ?? "",
   username: "",
   password: "",
   inTestnet: true,
   stuckTransactionOptions: {
      blockOffset: 1
   }
};

const fundedMnemonic = "once marine attract scorpion track summer choice hamster";
const fundedAddress = "nou7f8j829FAEb4SzLz3F1N1CrMAy58ohw";
const targetMnemonic = "involve essay clean frequent stumble cheese elite custom athlete rack obey walk";
const targetAddress = "nk1Uc5w6MHC1DgtRvnoQvCj3YgPemzha7D";

const DOGE_DECIMAL_PLACES = BTC_LTC_DOGE_DEC_PLACES;
const amountToSendInSatoshi = toBNExp(1.5, DOGE_DECIMAL_PLACES);
const feeInSatoshi = toBNExp(2, DOGE_DECIMAL_PLACES);
const maxFeeInSatoshi = toBNExp(1.5, DOGE_DECIMAL_PLACES);

let wClient: WALLET.DOGE;
let fundedWallet: ICreateWalletResponse;

describe("Dogecoin wallet tests", () => {
   before(() => {
      wClient = new WALLET.DOGE(DOGEMccConnectionTest);
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

   it("Should create and sign transaction", async () => {
      fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
      const transaction = await wClient.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendInSatoshi);
      const signed = await wClient.signTransaction(transaction, fundedWallet.privateKey as string);
      expect(typeof signed).to.equal("string");
   });

   it("Should timeout on waiting for address to be unlocked", async () => {
      void wClient.checkIfCanSubmitFromAddress(targetAddress);
      await expect(wClient.checkIfCanSubmitFromAddress(targetAddress))
         .to.eventually.be.rejectedWith(`Timeout waiting to obtain confirmed transaction from address ${targetAddress}`)
         .and.be.an.instanceOf(Error);
   });

   it("Should lock and execute multiple transactions from the same address", async () => {
      const lowFee = toBNExp(0.04, DOGE_DECIMAL_PLACES);
      const note = "50000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
      fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
      const balanceBefore = await wClient.getAccountBalance(targetAddress);
      const balanceBefore1 = await wClient.getAccountBalance(fundedWallet.address);
      await wClient.executeLockedSignedTransactionAndWait(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, lowFee, note);
      const balanceAfter = await wClient.getAccountBalance(targetAddress);
      const balanceAfter1 = await wClient.getAccountBalance(fundedWallet.address);
      expect(balanceBefore.lt(balanceAfter)).to.be.true;
      expect(balanceBefore1.gt(balanceAfter1)).to.be.true;
   });

   it("Should create transaction with custom fee", async () => {
      fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
      const tr = await wClient.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendInSatoshi, feeInSatoshi, "Note");
      expect(typeof tr).to.equal("object");
   });

   it("Should not create transaction: maxFee > fee", async () => {
      fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
      await expect(wClient.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendInSatoshi, feeInSatoshi, "Note", maxFeeInSatoshi)).to
         .eventually.be.rejected;
   });

   it("Should receive fee", async () => {
      const fee = await wClient.getCurrentTransactionFee();
      expect(fee).not.to.be.null;
   });

   it("Should receive latest blockHeight", async () => {
      const index = await wClient.getCurrentBlockHeight();
      expect(index).not.to.be.null;
   });

   it("Should not try to resubmit - transaction for source", async () => {
      const txHash = "txHash";
      const source = "source";
      await expect(wClient.tryToResubmitTransaction(txHash, source, "", 1, 1))
         .to.eventually.be.rejectedWith(`waitForTransaction: transaction ${txHash} for source ${source} cannot be found`)
         .and.be.an.instanceOf(Error);
   });
});
