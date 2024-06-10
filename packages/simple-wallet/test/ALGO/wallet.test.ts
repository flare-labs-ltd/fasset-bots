import { WALLET } from "../../src";
import { ICreateWalletResponse } from "../../src/interfaces/WriteWalletRpcInterface";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
import type { AlgoRpcConfig } from "../../src/interfaces/WriteWalletRpcInterface";
import { toBN, toNumber } from "@flarelabs/fasset-bots-core/utils";
use(chaiAsPromised);

const ALGOMccConnectionTest: AlgoRpcConfig = {
   url: process.env.ALGO_ALGOD_URL ?? "",
   apiTokenKey: process.env.ALGO_ALGOD_TOKEN ?? ""
};

let wClient: WALLET.ALGO;
let fundedWallet: ICreateWalletResponse;

const fundedMnemonic = "medal retire extra peasant fire venue turn company obtain gate fan affair nature private blood session leopard finish salon quarter major valve stem about wealth";
const fundedAddress = "T6WVPM7WLGP3DIBWNN3LJGCUNMFRR67BVV5KNS3VJ5HSEAQ3QKTGY5ZKWM";
const targetMnemonic = "burden gather evoke diamond educate mechanic gain foot bargain certain before ancient vanish crystal story friend equal repair gesture trend reduce one that absorb axis";
const targetAddress = "O2GT7KTTT7ESYYR6CJ23QQHXCVNV5W3MGYOYA2MGBPND5MB2BOPGVKFTLE";

const amountToSendInMicroALGO = toBN(1000);
const feeInMicroALGO = toBN(1500);
const maxFeeInMicroAlgo = toBN(1200);

describe("Algo wallet tests", () => {
   before(() => {
      wClient = new WALLET.ALGO(ALGOMccConnectionTest);
   });

   it("Should create account", async () => {
      const newAccount = wClient.createWallet();
      expect(newAccount.address).to.not.be.null;
      fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
      expect(fundedWallet.address).to.equal(fundedAddress);
      const targetWallet = wClient.createWalletFromMnemonic(targetMnemonic);
      expect(targetWallet.address).to.equal(targetAddress);
   });

   it("Should create, sign and submit transaction", async () => {
      const tr = await wClient.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendInMicroALGO, undefined, "Just submit");
      const signed = await wClient.signTransaction(tr, fundedWallet.privateKey);
      const submit = await wClient.submitTransaction(signed);
      expect(tr.txID()).to.equal(submit.txId);
   });

   it("Should create, sign, submit transaction", async () => {
      const balanceBefore = await wClient.getAccountBalance(targetAddress);
      const tr = await wClient.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendInMicroALGO, undefined, "Submit and wait");
      const signed = await wClient.signTransaction(tr, fundedWallet.privateKey);
      const submit = await wClient.submitTransaction(signed);
      await wClient.waitForTransaction(submit.txId);
      const balanceAfter = await wClient.getAccountBalance(targetAddress);
      expect(balanceBefore.lt(balanceAfter)).to.be.true;
      expect(typeof submit).to.equal("object");
   });

   it("Should create transaction without note", async () => {
      const tr = await wClient.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendInMicroALGO);
      expect(typeof tr).to.equal("object");
   });

   it("Should create transaction with custom fee", async () => {
      const tr = await wClient.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendInMicroALGO, feeInMicroALGO, "Just create");
      expect(tr.fee).to.equal(toNumber(feeInMicroALGO));
      expect(tr.flatFee).to.be.true;
   });

   it("Should not create transaction: maxFee > fee", async () => {
      await expect(wClient.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendInMicroALGO, feeInMicroALGO, "Just create", maxFeeInMicroAlgo))
         .to.eventually.be.rejected;
   });

   it("Should receive fee", async () => {
      const fee = await wClient.getCurrentTransactionFee();
      expect(fee).not.to.be.null;
   });

   it("Should return 'Method not implemented'", async () => {
      await expect(wClient.executeLockedSignedTransactionAndWait()).to.eventually.be.rejectedWith('Method not implemented.');
   });
});
