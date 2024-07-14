import { WALLET } from "../../src";
import { ICreateWalletResponse } from "../../src/interfaces/WriteWalletInterface";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);
import WAValidator from "wallet-address-validator";
import { toBN } from "../../src/utils/bnutils";
import rewire from "rewire";
import { initializeMikroORM } from "../../src/orm/mikro-orm.config";

const rewiredUTXOWalletImplementation = rewire("../../src/chain-clients/BtcWalletImplementation");
const rewiredUTXOWalletImplementationClass = rewiredUTXOWalletImplementation.__get__("BtcWalletImplementation");
const walletSecret = "wallet_secret";
// bitcoin test network with fundedAddress "mvvwChA3SRa5X8CuyvdT4sAcYNvN5FxzGE" at
// https://live.blockcypher.com/btc-testnet/address/mvvwChA3SRa5X8CuyvdT4sAcYNvN5FxzGE/

const BTCMccConnectionTest = {
   url: process.env.BTC_URL ?? "",
   username: "",
   password: "",
   apiTokenKey: process.env.FLARE_API_PORTAL_KEY ?? "",
   inTestnet: true,
   walletSecret: walletSecret
};

const fundedMnemonic = "theme damage online elite clown fork gloom alpha scorpion welcome ladder camp rotate cheap gift stone fog oval soda deputy game jealous relax muscle";
const fundedAddress = "tb1qyghw9dla9vl0kutujnajvl6eyj0q2nmnlnx3j0";
const targetMnemonic = "forget fine shop cage build else tree hurry upon sure diary multiply despair skirt hill mango hurdle first screen skirt kind fresh scene prize";
const targetAddress = "tb1q8j7jvsdqxm5e27d48p4382xrq0emrncwfr35k4";

//old funded - still have some funds
//mzM88w7CdxrFyzE8RKZmDmgYQgT5YPdA6S
//cNcsDiLQrYLi8rBERf9XPEQqVPHA7mUXHKWaTrvJVCTaNa68ZDqF
//old target - still have some funds
//a: mwLGdsLWvvGFapcFsx8mwxBUHfsmTecXe2
//pk: cTceSr6rvmAoQAXq617sk4smnzNUvAqkZdnfatfsjbSixBcJqDcY

const amountToSendSatoshi = toBN(10000);
const feeInSatoshi = toBN(120000);
const maxFeeInSatoshi = toBN(110000);

let wClient: WALLET.BTC;
let fundedWallet: ICreateWalletResponse;

describe("Bitcoin wallet tests", () => {
   before(async () => {
      wClient = await WALLET.BTC.initialize(BTCMccConnectionTest);
   });

   it("Should create account", async () => {
      const newAccount = wClient.createWallet();
      expect(newAccount.address).to.not.be.null;
      expect(WAValidator.validate(newAccount.address, "BTC", "testnet")).to.be.true;

      fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
      expect(fundedWallet.address).to.eq(fundedAddress);
      expect(WAValidator.validate(fundedWallet.address, "BTC", "testnet")).to.be.true;

      const targetWallet = wClient.createWalletFromMnemonic(targetMnemonic);
      expect(targetWallet.address).to.eq(targetAddress);
      expect(WAValidator.validate(targetWallet.address, "BTC", "testnet")).to.be.true;
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
      const rewired = new rewiredUTXOWalletImplementationClass(BTCMccConnectionTest);
      rewired.orm = await initializeMikroORM();
      fundedWallet = rewired.createWalletFromMnemonic(fundedMnemonic);
      const tr = await rewired.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendSatoshi, feeInSatoshi, "Note");
      expect(typeof tr).to.equal("object");
   });

   it("Should not create transaction: maxFee > fee", async () => {
      const rewired = new rewiredUTXOWalletImplementationClass(BTCMccConnectionTest);
      rewired.orm = await initializeMikroORM();
      fundedWallet = rewired.createWalletFromMnemonic(fundedMnemonic);
      await expect(rewired.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendSatoshi, feeInSatoshi, "Note", maxFeeInSatoshi)).to.eventually
         .be.rejectedWith(`Transaction preparation failed due to fee restriction (fee: ${feeInSatoshi.toString()}, maxFee: ${maxFeeInSatoshi.toString()})`);
   });

   it("Should receive fee", async () => {
      const fee = await wClient.getCurrentTransactionFee({source: fundedAddress, amount: amountToSendSatoshi, destination: targetAddress});
      expect(fee).not.to.be.null;
   });

   it.skip("Should prepare and execute transaction", async () => {
      // fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
      const tw = wClient.createWalletFromMnemonic(targetMnemonic);
      const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcac";
      const submit = await wClient.prepareAndExecuteTransaction(tw.address, tw.privateKey, fundedAddress, amountToSendSatoshi, undefined, note);
      expect(typeof submit).to.equal("object");
   });

   it.skip("Should prepare and execute transaction", async () => {
      fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
      const note = "dead0000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
      const submit = await wClient.deleteAccount(fundedWallet.address, fundedWallet.privateKey, targetAddress, undefined, note);
      expect(typeof submit).to.equal("object");
   });
});
