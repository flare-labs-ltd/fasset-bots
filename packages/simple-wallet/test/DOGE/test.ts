import { WALLET } from "../../src";
import { ICreateWalletResponse } from "../../src/interfaces/WriteWalletInterface";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);
import WAValidator from "wallet-address-validator";
import { BTC_LTC_DOGE_DEC_PLACES, ChainType, DOGE_DUST_AMOUNT } from "../../src/utils/constants";
import { toBNExp } from "../../src/utils/bnutils";
import { sleepMs } from "../../src/utils/utils";

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
const targetAddress2 = "ninzuJgMk9YEuwqam9GzwV4hEgcqyKnkyS";

// {
//     address: 'ninzuJgMk9YEuwqam9GzwV4hEgcqyKnkyS',
//     mnemonic: 'depart duty good motion dog salon soldier globe print glow powder mule',
//     privateKey: 'cgZDt2LnyFmdnovQYceK9m6mpZxqSpDHv7UTZN3g8gZTEv2d5vB2'
//   }

const DOGE_DECIMAL_PLACES = BTC_LTC_DOGE_DEC_PLACES;
const amountToSendInSatoshi = toBNExp(1.5, DOGE_DECIMAL_PLACES);
const feeInSatoshi = toBNExp(2, DOGE_DECIMAL_PLACES);
const maxFeeInSatoshi = toBNExp(1.5, DOGE_DECIMAL_PLACES);

let wClient: WALLET.DOGE;
let fundedWallet: ICreateWalletResponse;

describe("Dogecoin TEST tests", () => {
   before(async () => {
      wClient = await WALLET.DOGE.initialize(DOGEMccConnectionTest);
   });

   it.only("Should lock and execute multiple transactions from the same address", async () => {
      const lowFee = toBNExp(0.04, DOGE_DECIMAL_PLACES);
      const note = "eeee0000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
      fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
      const balanceBefore = await wClient.getAccountBalance(targetAddress);
      const balanceBefore1 = await wClient.getAccountBalance(fundedWallet.address);
      console.log("UTXO0")
      const utxos0 = await wClient.fetchUTXOs(fundedWallet.address, amountToSendInSatoshi, 3);
      console.log(utxos0)
      const tx = await wClient.prepareAndExecuteTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, undefined, note);
      console.log(tx);
      console.log("sleeping...")
      await sleepMs(10000)
      const note1 = "20000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
      const tx1 = await wClient.prepareAndExecuteTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress2, amountToSendInSatoshi, undefined, note1);
      console.log(tx1);
      console.log("UTXO1")
      const utxos1 = await wClient.fetchUTXOs(fundedWallet.address, null, 0);
      console.log(utxos1)
      const balanceAfter = await wClient.getAccountBalance(targetAddress);
      const balanceAfter1 = await wClient.getAccountBalance(fundedWallet.address);
      console.log(balanceBefore.toString(), balanceAfter.toString())
      console.log(balanceBefore1.toString(), balanceAfter1.toString())

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
