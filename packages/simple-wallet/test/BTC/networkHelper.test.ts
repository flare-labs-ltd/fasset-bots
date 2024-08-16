import { expect } from "chai";
import { WALLET } from "../../src";
import { BTC_MAINNET, BTC_TESTNET } from "../../src/utils/constants";
import { getCurrentNetwork } from "../../src/utils/utils";
import { initializeTestMikroORM } from "../test-orm/mikro-orm.config";
import { UnprotectedDBWalletKeys } from "../test-orm/UnprotectedDBWalletKey";

describe("Bitcoin network helper tests", () => {
   it("Should switch to mainnet", async () => {
      const BTCMccConnectionMainInitial = {
         url: process.env.BTC_URL ?? "",
         username: "",
         password: "",
         rateLimitOptions: {
            timeoutMs: 15000,
         },
      };
      const testOrm = await initializeTestMikroORM();
      const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
      const BTCMccConnectionMain = { ...BTCMccConnectionMainInitial, em: testOrm.em, walletKeys: unprotectedDBWalletKeys };
      const wClient: WALLET.BTC = await WALLET.BTC.initialize(BTCMccConnectionMain);
      const currentNetwork = getCurrentNetwork(wClient.chainType);
      expect(currentNetwork).to.eql(BTC_MAINNET);
   });

   it("Should switch to testnet", async () => {
      const BTCMccConnectionTestInitial = {
         url: process.env.BTC_URL ?? "",
         username: "",
         password: "",
         inTestnet: true,

      };
      const testOrm = await initializeTestMikroORM();
      const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
      const BTCMccConnectionTest = { ...BTCMccConnectionTestInitial, em: testOrm.em, walletKeys: unprotectedDBWalletKeys };
      const wClient: WALLET.BTC = await WALLET.BTC.initialize(BTCMccConnectionTest);
      const currentNetwork = getCurrentNetwork(wClient.chainType);
      expect(currentNetwork).to.eql(BTC_TESTNET);
   });

   it("Should create config with username and password to testnet", async () => {
      const BTCMccConnectionTestInitial = {
         url: process.env.BTC_URL ?? "",
         username: "username",
         password: "password",
         inTestnet: true,

      };
      const testOrm = await initializeTestMikroORM();
      const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
      const BTCMccConnectionTest = { ...BTCMccConnectionTestInitial, em: testOrm.em, walletKeys: unprotectedDBWalletKeys };
      const wClient: WALLET.BTC = await WALLET.BTC.initialize(BTCMccConnectionTest);
      expect(wClient.client.defaults.auth).to.not.be.undefined;
   });
});
