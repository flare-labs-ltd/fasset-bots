import { WALLET } from "../../src";
import { ICreateWalletResponse } from "../../src/interfaces/WriteWalletInterface";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);
import WAValidator from "wallet-address-validator";
import { BTC_DOGE_DEC_PLACES, DOGE_DUST_AMOUNT } from "../../src/utils/constants";
import { toBNExp } from "../../src/utils/bnutils";
import rewire from "rewire";
import { initializeMikroORM } from "../../src/orm/mikro-orm.config";

const rewiredUTXOWalletImplementation = rewire("../../src/chain-clients/DogeWalletImplementation");
const rewiredUTXOWalletImplementationClass = rewiredUTXOWalletImplementation.__get__("DogeWalletImplementation");

const DOGEMccConnectionTest = {
   url: process.env.DOGE_URL ?? "",
   username: "",
   password: "",
   inTestnet: true,
   stuckTransactionOptions: {
      blockOffset: 1
   },
};

const fundedMnemonic = "once marine attract scorpion track summer choice hamster";
const fundedAddress = "nou7f8j829FAEb4SzLz3F1N1CrMAy58ohw";
const targetMnemonic = "involve essay clean frequent stumble cheese elite custom athlete rack obey walk";
const targetAddress = "nk1Uc5w6MHC1DgtRvnoQvCj3YgPemzha7D";

// zeroth derivative is fundedAddress
// first derivative using fundedMnemonic by using bip32Path: "m/44'/3'/1'"
// {
//    address: 'nr9YSnQKPprLq2ZFFnKJZR3ZgfUFu2Goro',
//    mnemonic: 'once marine attract scorpion track summer choice hamster',
//    privateKey: 'ckzzFoCjnLv9Div59fpwXtvCpUxEwhiHQWEGV6nEsLQfWUDs6h4J'
//  }

const DOGE_DECIMAL_PLACES = BTC_DOGE_DEC_PLACES;
const amountToSendInSatoshi = toBNExp(1.5, DOGE_DECIMAL_PLACES);
const feeInSatoshi = toBNExp(2, DOGE_DECIMAL_PLACES);
const maxFeeInSatoshi = toBNExp(1.5, DOGE_DECIMAL_PLACES);

let wClient: WALLET.DOGE;
let fundedWallet: ICreateWalletResponse;

describe("Dogecoin wallet tests", () => {
   before(async () => {
      wClient = await WALLET.DOGE.initialize(DOGEMccConnectionTest);
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
      const rewired = new rewiredUTXOWalletImplementationClass(DOGEMccConnectionTest);
      rewired.orm = await initializeMikroORM("simple-wallet_doge.db");
      fundedWallet = rewired.createWalletFromMnemonic(fundedMnemonic);
      const transaction = await rewired.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendInSatoshi);
      const signed = await rewired.signTransaction(transaction, fundedWallet.privateKey as string);
      expect(typeof signed).to.equal("string");
   });

   it("Should prepare and execute transaction", async () => {
      fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
      const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
      const submit = await wClient.prepareAndExecuteTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, undefined, note);
      expect(typeof submit).to.equal("object");
   });

   it("Should prepare and execute transactions", async () => {
      fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
      const note0 = "00000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
      const note1 = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
      const note2 = "20000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
      const resp0 = await wClient.prepareAndExecuteTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, undefined, note0);
      expect(typeof resp0).to.equal("object");
      const resp1 = await wClient.prepareAndExecuteTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, undefined, note1);
      expect(typeof resp1).to.equal("object");
      const resp2 = await wClient.prepareAndExecuteTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, undefined, note2);
      expect(typeof resp2).to.equal("object");
   });

   it("Should create transaction with custom fee", async () => {
      const rewired = new rewiredUTXOWalletImplementationClass(DOGEMccConnectionTest);
      rewired.orm = await initializeMikroORM("simple-wallet_doge.db");
      fundedWallet = rewired.createWalletFromMnemonic(fundedMnemonic);
      const tr = await rewired.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendInSatoshi, feeInSatoshi, "Note");
      expect(typeof tr).to.equal("object");
   });

   it("Should not create transaction: maxFee > fee", async () => {
      const rewired = new rewiredUTXOWalletImplementationClass(DOGEMccConnectionTest);
      rewired.orm = await initializeMikroORM("simple-wallet_doge.db");
      fundedWallet = rewired.createWalletFromMnemonic(fundedMnemonic);
      await expect(rewired.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendInSatoshi, feeInSatoshi, "Note", maxFeeInSatoshi)).to
         .eventually.be.rejectedWith(`Transaction preparation failed due to fee restriction (fee: ${feeInSatoshi.toString()}, maxFee: ${maxFeeInSatoshi.toString()})`);
   });

   it("Should not create transaction: amount = dust amount", async () => {
      const rewired = new rewiredUTXOWalletImplementationClass(DOGEMccConnectionTest);
      rewired.orm = await initializeMikroORM("simple-wallet_doge.db");
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

   it("Should create and delete account", async () => {
      const toDelete = wClient.createWallet();
      expect(toDelete.address).to.not.be.null;
      expect(WAValidator.validate(toDelete.address, "DOGE", "testnet")).to.be.true;
      fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
      expect(WAValidator.validate(fundedWallet.address, "DOGE", "testnet")).to.be.true;
      // fund toDelete account
      await wClient.prepareAndExecuteTransaction(fundedWallet.address, fundedWallet.privateKey, toDelete.address, amountToSendInSatoshi);
      const balance = await wClient.getAccountBalance(toDelete.address);
      // delete toDelete account
      const note = "dead0000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
      await wClient.deleteAccount(toDelete.address, toDelete.privateKey, fundedWallet.address, undefined, note);
      const balance2 = await wClient.getAccountBalance(toDelete.address);
      expect(balance.gt(balance2));
   });
});
