import { WALLET } from "../../src";
import { ICreateWalletResponse } from "../../src/interfaces/WriteWalletRpcInterface";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);
import WAValidator from "wallet-address-validator";
import { toBN } from "../../src/utils/bnutils";

// bitcoin test network with fundedAddress "mvvwChA3SRa5X8CuyvdT4sAcYNvN5FxzGE" at
// https://live.blockcypher.com/btc-testnet/address/mvvwChA3SRa5X8CuyvdT4sAcYNvN5FxzGE/

const BTCMccConnectionTest = {
   url: process.env.BTC_URL ?? "",
   username: "",
   password: "",
   apiTokenKey: process.env.FLARE_API_PORTAL_KEY ?? "",
   inTestnet: true
};

const fundedMnemonic = "depart mixed miss smart enjoy ladder deputy sport chair risk dismiss few";
const fundedAddress = "mzM88w7CdxrFyzE8RKZmDmgYQgT5YPdA6S";
const targetMnemonic = "involve essay clean frequent stumble cheese elite custom athlete rack obey walk";
const targetAddress = "mwLGdsLWvvGFapcFsx8mwxBUHfsmTecXe2";

const amountToSendSatoshi = toBN(120000);
const feeInSatoshi = toBN(120000);
const maxFeeInSatoshi = toBN(110000);

let wClient: WALLET.BTC;
let fundedWallet: ICreateWalletResponse;

describe("Bitcoin wallet tests", () => {
   before(() => {
      wClient = new WALLET.BTC(BTCMccConnectionTest);
   });

   it("Should create account", async () => {
      const newAccount = wClient.createWallet();
      expect(newAccount.address).to.not.be.null;
      fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
      expect(fundedWallet.address).to.eq(fundedAddress);
      const targetWallet = wClient.createWalletFromMnemonic(targetMnemonic);
      expect(targetWallet.address).to.eq(targetAddress);
      expect(WAValidator.validate(newAccount.address, "BTC", "testnet")).to.be.true;
      expect(WAValidator.validate(fundedWallet.address, "BTC", "testnet")).to.be.true;
      expect(WAValidator.validate(targetWallet.address, "BTC", "testnet")).to.be.true;
   });

   it("Should create transaction with custom fee", async () => {
      fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
      const tr = await wClient.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendSatoshi, feeInSatoshi, "Note");
      expect(typeof tr).to.equal("object");
   });

   it("Should not create transaction: maxFee > fee", async () => {
      fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
      await expect(wClient.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendSatoshi, feeInSatoshi, "Note", maxFeeInSatoshi)).to.eventually
         .be.rejected;
   });

   it("Should receive fee", async () => {
      const fee = await wClient.getCurrentTransactionFee({source: fundedAddress, amount: amountToSendSatoshi, destination: targetAddress});
      expect(fee).not.to.be.null;
   });
});
