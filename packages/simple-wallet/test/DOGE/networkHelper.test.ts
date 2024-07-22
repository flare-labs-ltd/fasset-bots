import { expect } from "chai";
import { WALLET } from "../../src";
import { DEFAULT_RATE_LIMIT_OPTIONS, DOGE_MAINNET, DOGE_TESTNET } from "../../src/utils/constants";
import { getCurrentNetwork } from "../../src/utils/utils";
import { initializeTestMikroORM } from "../test-orm/mikro-orm.config";
import { UnprotectedDBWalletKeys } from "../test-orm/UnprotectedDBWalletKey";

describe("Dogecoin network helper tests", () => {
   it("Should switch to mainnet", async () => {
      const DOGEMccConnectionMainInitial = {
         url: process.env.DOGE_URL ?? "",
         username: "",
         password: "",
      };
      const testOrm = await initializeTestMikroORM();
      const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
      const DOGEMccConnectionMain = { ...DOGEMccConnectionMainInitial, em: testOrm.em, walletKeys: unprotectedDBWalletKeys };
      const wClient: WALLET.DOGE = await WALLET.DOGE.initialize(DOGEMccConnectionMain);
      const currentNetwork = getCurrentNetwork(wClient.chainType);
      expect(currentNetwork).to.eql(DOGE_MAINNET);
   });

   it("Should switch to testnet", async () => {
      const DOGEMccConnectionTestInitial = {
         url: process.env.DOGE_URL ?? "",
         username: "",
         password: "",
         inTestnet: true,

      };
      const testOrm = await initializeTestMikroORM();
      const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
      const DOGEMccConnectionTest = { ...DOGEMccConnectionTestInitial, em: testOrm.em, walletKeys: unprotectedDBWalletKeys };
      const wClient: WALLET.DOGE = await WALLET.DOGE.initialize(DOGEMccConnectionTest);
      const currentNetwork = getCurrentNetwork(wClient.chainType);
      expect(currentNetwork).to.eql(DOGE_TESTNET);
   });

   it("Should create config with predefined 'stuckTransactionConstants'", async () => {
      const DOGEMccConnectionTestInitial = {
         url: process.env.DOGE_URL ?? "",
         username: "",
         password: "",
         inTestnet: true, stuckTransactionOptions: { blockOffset: 10, retries: 5, feeIncrease: 4 },

      };
      const testOrm = await initializeTestMikroORM();
      const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
      const DOGEMccConnectionTest = { ...DOGEMccConnectionTestInitial, em: testOrm.em, walletKeys: unprotectedDBWalletKeys };
      const wClient = await WALLET.DOGE.initialize(DOGEMccConnectionTest);
      expect(wClient.client.defaults.timeout).to.eq(DEFAULT_RATE_LIMIT_OPTIONS.timeoutMs);
   });
});
