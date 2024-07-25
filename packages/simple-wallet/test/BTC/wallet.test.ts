import { WALLET } from "../../src";
import { BitcoinWalletConfig, ICreateWalletResponse } from "../../src/interfaces/WalletTransactionInterface";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);
import WAValidator from "wallet-address-validator";
import { toBN } from "../../src/utils/bnutils";
import rewire from "rewire";
import { fetchTransactionEntityById } from "../../src/db/dbutils";
import { sleepMs } from "../../src/utils/utils";
import { TransactionStatus } from "../../src/entity/transaction";
import { initializeTestMikroORM } from "../test-orm/mikro-orm.config";
import { UnprotectedDBWalletKeys } from "../test-orm/UnprotectedDBWalletKey";

const rewiredUTXOWalletImplementation = rewire("../../src/chain-clients/BtcWalletImplementation");
const rewiredUTXOWalletImplementationClass = rewiredUTXOWalletImplementation.__get__("BtcWalletImplementation");
const walletSecret = "wallet_secret";
// bitcoin test network with fundedAddress "mvvwChA3SRa5X8CuyvdT4sAcYNvN5FxzGE" at
// https://live.blockcypher.com/btc-testnet/address/mvvwChA3SRa5X8CuyvdT4sAcYNvN5FxzGE/

const BTCMccConnectionTestInitial = {
   url: process.env.BTC_URL ?? "",
   username: "",
   password: "",
   apiTokenKey: process.env.FLARE_API_PORTAL_KEY ?? "",
   inTestnet: true,
   walletSecret: walletSecret
};
let BTCMccConnectionTest: BitcoinWalletConfig;

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

//funded
// xpub:  vpub5ZQX8V9N9iEqpgfZo42p6eRSA1px1h1cWGvsLjbMbvXE6ymgKCtqq3oZs8dWp2F85pw23QYY8YWqTb1BpCq7G4FQXcSeDv8kFeBiqD7LCvo
// first change address: tb1q9szxd7rnvkkspxp0sl8mha5jk38q9t3rlc2wjx
// first change address private key: cQpQrPr1yrdPLdom5dkxjJgh8bsKp284tPFa2znRs9RTB1VkzQyq
//target
// xpub:  vpub5ZXcEAAqkR4Lg3CBfdYC1fUHkrdRfzxCbRg6tpvERsLB1HpH1KCRcTzQ9TcaLymXpYQmAtyccAcXc1z6UpVNMgcHSuZmmS1YzpvYRHWqd3X
// first change address: tb1q38w40nmt5chk4a60mrh502h7m3l5w6pxpxvr0c
// first change address private key: cTyRVJd6AUUshTBS7DcxfemJh6zeb3iCEJCWYtBsTHizybuHFt6r

const amountToSendSatoshi = toBN(10000);
const feeInSatoshi = toBN(120000);
const maxFeeInSatoshi = toBN(110000);

let wClient: WALLET.BTC;
let fundedWallet: ICreateWalletResponse;

describe("Bitcoin wallet tests", () => {
   before(async () => {
      const testOrm = await initializeTestMikroORM();
      const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
      BTCMccConnectionTest = { ...BTCMccConnectionTestInitial, em: testOrm.em, walletKeys: unprotectedDBWalletKeys };
      wClient = await WALLET.BTC.initialize(BTCMccConnectionTest);
      void wClient.startMonitoringTransactionProgress()
   });

   after(function() {
      wClient.stopMonitoring();
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
      rewired.orm = await initializeTestMikroORM();
      fundedWallet = rewired.createWalletFromMnemonic(fundedMnemonic);
      const tr = await rewired.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendSatoshi, feeInSatoshi, "Note");
      expect(typeof tr).to.equal("object");
   });

   it("Should not create transaction: maxFee > fee", async () => {
      const rewired = new rewiredUTXOWalletImplementationClass(BTCMccConnectionTest);
      rewired.orm = await initializeTestMikroORM();
      fundedWallet = rewired.createWalletFromMnemonic(fundedMnemonic);
      await expect(rewired.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendSatoshi, feeInSatoshi, "Note", maxFeeInSatoshi)).to.eventually
         .be.rejectedWith(`Transaction preparation failed due to fee restriction (fee: ${feeInSatoshi.toString()}, maxFee: ${maxFeeInSatoshi.toString()})`);
   });

   it("Should receive fee", async () => {
      const fee = await wClient.getCurrentTransactionFee({source: fundedAddress, amount: amountToSendSatoshi, destination: targetAddress});
      expect(fee).not.to.be.null;
   });

   it.skip("Should prepare and execute transaction", async () => {
      fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
      const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcac";
      const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, undefined, note, undefined);
      expect(id).to.be.gt(0);
      const startTime = Date.now();
      const timeLimit = 600000; // 600 s
      for (let i = 0; ; i++) {
         const tx = await fetchTransactionEntityById(wClient.rootEm, id);
         if (tx.status == TransactionStatus.TX_SUCCESS) {
            break;
         }
         if (Date.now() - startTime > timeLimit) {
            console.log(tx)
            throw new Error(`Time limit exceeded for ${tx.id} with ${tx.transactionHash}`);
         }
         wClient.rootEm.clear();
         await sleepMs(2000);
     }
   });

   //TODO
   // it.skip("Should prepare and execute transaction", async () => {
   //    fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
   //    const note = "dead0000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
   //    const submit = await wClient.deleteAccount(fundedWallet.address, fundedWallet.privateKey, targetAddress, undefined, note);
   //    expect(typeof submit).to.equal("object");
   // });
});
