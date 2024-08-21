import { expect } from "chai";
import { WALLET } from "../../src";
import { DEFAULT_RATE_LIMIT_OPTIONS_XRP } from "../../src/utils/constants";
import { RippleWalletConfig } from "../../src/interfaces/IWalletTransaction";
import { initializeTestMikroORM } from "../test-orm/mikro-orm.config";
import { UnprotectedDBWalletKeys } from "../test-orm/UnprotectedDBWalletKey";

describe("XRP network helper tests", () => {
   it("Should create config with username and password to testnet", async () => {
      const XRPMccConnectionTestInitial = {
         url: process.env.XRP_URL ?? "",
         username: "username",
         password: "password",
         inTestnet: true,

      };
      const testOrm = await initializeTestMikroORM();
      const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
      const XRPMccConnectionTest: RippleWalletConfig = { ... XRPMccConnectionTestInitial, em: testOrm.em, walletKeys: unprotectedDBWalletKeys };
      const wClient: WALLET.XRP = await WALLET.XRP.initialize(XRPMccConnectionTest);
      expect(wClient.client.defaults.auth).to.not.be.undefined;
   });

   it("Should create config with custom timeouts", async () => {
      const XRPMccConnectionTestInitial = {
         url: process.env.XRP_URL ?? "",
         rateLimitOptions: {
            timeoutMs: 16000,
         },
      };
      const testOrm = await initializeTestMikroORM();
      const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
      const XRPMccConnectionTest: RippleWalletConfig = { ... XRPMccConnectionTestInitial, em: testOrm.em, walletKeys: unprotectedDBWalletKeys };
      const wClient: WALLET.XRP = await WALLET.XRP.initialize(XRPMccConnectionTest);
      expect(wClient.client.defaults.timeout).to.eq(XRPMccConnectionTest.rateLimitOptions!.timeoutMs);
   });

   it("Should create config with default settings", async () => {
      const XRPMccConnectionTestInitial = {
         url: process.env.XRP_URL ?? "",
      };
      const testOrm = await initializeTestMikroORM();
      const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
      const XRPMccConnectionTest: RippleWalletConfig = { ... XRPMccConnectionTestInitial, em: testOrm.em, walletKeys: unprotectedDBWalletKeys };
      const wClient = await WALLET.XRP.initialize(XRPMccConnectionTest);
      expect(wClient.client.defaults.timeout).to.eq(DEFAULT_RATE_LIMIT_OPTIONS_XRP.timeoutMs);
   });

   it("Should create config with predefined 'stuckTransactionConstants'", async () => {
      const XRPMccConnectionTestInitial = { url: process.env.XRP_URL ?? "", stuckTransactionOptions: { blockOffset: 10, retries: 5, feeIncrease: 4 },  };
      const testOrm = await initializeTestMikroORM();
      const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
      const XRPMccConnectionTest: RippleWalletConfig = { ... XRPMccConnectionTestInitial, em: testOrm.em, walletKeys: unprotectedDBWalletKeys };
      const wClient = await WALLET.XRP.initialize(XRPMccConnectionTest);
      expect(wClient.client.defaults.timeout).to.eq(DEFAULT_RATE_LIMIT_OPTIONS_XRP.timeoutMs);
      expect(wClient.blockOffset).to.eq(XRPMccConnectionTest.stuckTransactionOptions!.blockOffset);
      expect(wClient.feeIncrease).to.eq(XRPMccConnectionTest.stuckTransactionOptions!.feeIncrease);
   });
});
