import { WALLET } from "../../src";
import { ICreateWalletResponse, RippleWalletConfig } from "../../src/interfaces/WriteWalletInterface";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);
import { encode } from "xrpl";
import WAValidator from "wallet-address-validator";
import rewire from "rewire";
import { XRP_DECIMAL_PLACES } from "../../src/utils/constants";
import { toBN, toBNExp } from "../../src/utils/bnutils";
import { initializeMikroORM } from "../../src/orm/mikro-orm.config";
import { createTransactionEntity } from "../../src/utils/dbutils";

const rewiredXrpWalletImplementation = rewire("../../src/chain-clients/XrpWalletImplementation");
const rewiredXrpWalletImplementationClass = rewiredXrpWalletImplementation.__get__("XrpWalletImplementation");

const XRPMccConnectionTest: RippleWalletConfig = {
   url: process.env.XRP_URL ?? "",
   username: "",
   password: "",
   stuckTransactionOptions: {
      blockOffset: 10,
      retries: 2,
      lastResortFee: 1e5
   },
   rateLimitOptions: {
      timeoutMs: 60000,
   },
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
const blockOffset = 25;

let wClient: WALLET.XRP;
let fundedWallet: ICreateWalletResponse; //testnet, seed: sannPkA1sGXzM1MzEZBjrE1TDj4Fr, account: rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8

describe("Xrp wallet tests", () => {
   before(async () => {
      wClient = await WALLET.XRP.initialize(XRPMccConnectionTest);
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

   it("Should create, sign and submit transaction", async () => {
      const rewired = new rewiredXrpWalletImplementationClass(XRPMccConnectionTest);
      fundedWallet = rewired.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
      const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
      const tr = await rewired.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendDropsFirst, undefined, note);
      const blob = await rewired.signTransaction(tr, fundedWallet.privateKey as string);
      const submit = await rewired.submitTransaction(blob);
      expect(typeof submit).to.equal("object");
   });

   it("Should create transaction with sequence and fee", async () => {
      const rewired = new rewiredXrpWalletImplementationClass(XRPMccConnectionTest);
      fundedWallet = rewired.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
      const tr = await rewired.preparePaymentTransaction(
         fundedWallet.address,
         targetAddress,
         amountToSendDropsSecond,
         feeInDrops,
         "Submit",
         undefined,
         sequence
      );
      expect(typeof tr).to.equal("object");
   });

   it("Should not submit unsigned transaction", async () => {
      const rewired = new rewiredXrpWalletImplementationClass(XRPMccConnectionTest);
      fundedWallet = rewired.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
      const tr = await rewired.preparePaymentTransaction(
         fundedWallet.address,
         targetAddress,
         amountToSendDropsSecond,
         feeInDrops,
         "Submit",
         undefined,
         sequence
      );
      const serialized = encode(tr);
      await expect(rewired.submitTransaction(serialized)).to.eventually.be.rejected.and.be.an.instanceOf(Error);
   });

   it("Should not create transaction: fee > maxFee", async () => {
      const rewired = new rewiredXrpWalletImplementationClass(XRPMccConnectionTest);
      fundedWallet = rewired.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
      await expect(rewired.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendDropsSecond, feeInDrops, "Submit", maxFeeInDrops))
         .to.eventually.be.rejectedWith(`Transaction preparation failed due to fee restriction (fee: ${feeInDrops}, maxFee: ${maxFeeInDrops})`)
         .and.be.an.instanceOf(Error);
   });

   it("Should receive fee", async () => {
      const feeP = await wClient.getCurrentTransactionFee({ isPayment: true });
      expect(feeP).not.to.be.null;
      const fee = await wClient.getCurrentTransactionFee({ isPayment: false });
      expect(fee).not.to.be.null;
   });

   it("Should receive latest validated ledger index", async () => {
      const index = await wClient.getLatestValidatedLedgerIndex();
      expect(index).not.to.be.null;
   });

   it("Should not find transaction", async () => {
      const rewired = new rewiredXrpWalletImplementationClass(XRPMccConnectionTest);
      rewired.orm = await initializeMikroORM("simple-wallet_xrp.db");
      const txHash = "TXTXTXTXTXTXTXTXTXTXTXTXTXTXTXTXTXTXTXTXTXTXTXTXTXTXTXTXTXTXTXTX"
      await createTransactionEntity(rewired.orm, {}, "", "", txHash);
      await expect(rewired.waitForTransaction(txHash, "tesSUCCESS"))
         .to.eventually.be.rejectedWith(`waitForTransaction: notImpl Submission result: tesSUCCESS`)
         .and.be.an.instanceOf(Error);
   });

   it("Should timeout on waiting for address to be unlocked", async () => {
      const rewired = new rewiredXrpWalletImplementationClass(XRPMccConnectionTest);
      const address = "rhNMdXAuUQGmaPmYBj84f9zaEyq9qXFwfs"; // secret=sEd7pKYYVphXge4My2q98M6BPJTPUPk
      void rewired.checkIfCanSubmitFromAddress(address);
      await expect(rewired.checkIfCanSubmitFromAddress(address))
         .to.eventually.be.rejectedWith(`Timeout waiting to obtain confirmed transaction from address ${address}`)
         .and.be.an.instanceOf(Error);
   });

   it("Should replace transactions with low fee", async () => {
      const lowFee = toBN(5);
      fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
      const balanceSourceBefore = await wClient.getAccountBalance(fundedWallet.address);
      const balanceTargetBefore = await wClient.getAccountBalance(targetAddress);
      const latestToBeAccepted = await wClient.getLatestValidatedLedgerIndex() + blockOffset;
      await wClient.prepareAndExecuteTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendDropsSecond, lowFee, undefined, undefined, undefined, latestToBeAccepted);
      const balanceSourceAfter = await wClient.getAccountBalance(fundedWallet.address);
      const balanceTargetAfter = await wClient.getAccountBalance(targetAddress);
      expect(balanceSourceAfter.eq(balanceSourceBefore.sub(amountToSendDropsSecond).sub(lowFee.muln(2))));
      expect(balanceTargetAfter.eq(balanceTargetBefore.add(amountToSendDropsSecond)));
   });

   //TODO - check
   it.skip("Should replace transactions with last resort fee", async () => {
      const lowFee = toBN(1);
      fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
      const balanceSourceBefore = await wClient.getAccountBalance(fundedWallet.address);
      const balanceTargetBefore = await wClient.getAccountBalance(targetAddress);
      const latestToBeAccepted = await wClient.getLatestValidatedLedgerIndex() + blockOffset;
      await wClient.prepareAndExecuteTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendDropsSecond, lowFee, undefined, undefined, undefined, latestToBeAccepted);
      const balanceSourceAfter = await wClient.getAccountBalance(fundedWallet.address);
      const balanceTargetAfter = await wClient.getAccountBalance(targetAddress);
      expect(balanceSourceAfter.eq(balanceSourceBefore.sub(amountToSendDropsSecond).subn(wClient.lastResortFeeInDrops!)));
      expect(balanceTargetAfter.eq(balanceTargetBefore.add(amountToSendDropsSecond)));
   });

   it("Should not replace transactions with low fee - fee to high", async () => {
      const lowFee = toBN(1);
      fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
      const latestToBeAccepted = await wClient.getLatestValidatedLedgerIndex() + blockOffset;
      await expect(wClient.prepareAndExecuteTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendDropsSecond, lowFee, undefined, maxFeeInDrops, undefined, latestToBeAccepted))
         .to.eventually.be.rejectedWith(`Transaction preparation failed due to fee restriction (fee: ${XRPMccConnectionTest.stuckTransactionOptions?.lastResortFee}, maxFee: ${maxFeeInDrops?.toString()})`)
         .and.be.an.instanceOf(Error);
   });

   it("Should not try to resubmit - transaction for source", async () => {
      const rewired = new rewiredXrpWalletImplementationClass(XRPMccConnectionTest);
      const txHash = "txHash";
      const source = "source";
      await expect(rewired.tryToResubmitTransaction(txHash, "", source, "", 1))
         .to.eventually.be.rejectedWith(`waitForTransaction: transaction ${txHash} for source ${source} cannot be found`)
         .and.be.an.instanceOf(Error);
   });

   /* describe("congested network tests", () => {
      const ntx = 1;
      it("Should create sign and send transactions in a congested network", async () => {
         await Promise.all(Array(ntx).fill(0).map(async (_, i) => {
            console.log(`i: ` + (await wClient.getCurrentTransactionFee()).toString())
            fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
            const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
            const tr = await wClient.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendDropsFirst, undefined, note);
            const blob = await wClient.signTransaction(tr, fundedWallet.privateKey as string);
            const submit = await wClient.submitTransaction(blob);
            expect(typeof submit).to.equal("object");
            console.log(submit)
         }))
      })
   }) */

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
      await wClient.prepareAndExecuteTransaction(fundedWallet.address, fundedWallet.privateKey, toDelete.address, toSendInDrops);
      const balance = await wClient.getAccountBalance(toDelete.address);
      // delete toDelete account
      await wClient.deleteAccount(toDelete.address, toDelete.privateKey, fundedWallet.address);
      const balance2 = await wClient.getAccountBalance(toDelete.address);
      expect(balance.gt(balance2));
   });
});
