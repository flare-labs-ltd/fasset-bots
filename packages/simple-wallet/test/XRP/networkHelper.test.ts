import { expect } from "chai";
import { WALLET } from "../../src";
import { DEFAULT_RATE_LIMIT_OPTIONS_XRP } from "../../src/utils/constants";

describe("XRP network helper tests", () => {
   it("Should create config with username and password to testnet", async () => {
      const XRPMccConnectionTest = {
         url: process.env.XRP_URL ?? "",
         username: "username",
         password: "password",
         inTestnet: true,
         walletSecret: "wallet_secret"
      };
      const wClient: WALLET.XRP = await WALLET.XRP.initialize(XRPMccConnectionTest);
      expect(wClient.client.defaults.auth).to.not.be.undefined;
   });

   it("Should create config with custom timeouts", async () => {
      const XRPMccConnectionTest = {
         url: process.env.XRP_URL ?? "",
         rateLimitOptions: {
            timeoutMs: 16000,
         },
         walletSecret: "wallet_secret"
      };
      const wClient: WALLET.XRP = await WALLET.XRP.initialize(XRPMccConnectionTest);
      expect(wClient.client.defaults.timeout).to.eq(XRPMccConnectionTest.rateLimitOptions.timeoutMs);
   });

   it("Should create config with default settings", async () => {
      const wClient = await WALLET.XRP.initialize({ url: process.env.XRP_URL ?? "", walletSecret: "wallet_secret" });
      expect(wClient.client.defaults.timeout).to.eq(DEFAULT_RATE_LIMIT_OPTIONS_XRP.timeoutMs);
   });

   it("Should create config with predefined 'stuckTransactionConstants'", async () => {
      const XRPMccConnectionTest = { url: process.env.XRP_URL ?? "", stuckTransactionOptions: { blockOffset: 10, retries: 5, feeIncrease: 4 }, walletSecret: "wallet_secret" };
      const wClient = await WALLET.XRP.initialize(XRPMccConnectionTest);
      expect(wClient.client.defaults.timeout).to.eq(DEFAULT_RATE_LIMIT_OPTIONS_XRP.timeoutMs);
      expect(wClient.blockOffset).to.eq(XRPMccConnectionTest.stuckTransactionOptions.blockOffset);
      expect(wClient.feeIncrease).to.eq(XRPMccConnectionTest.stuckTransactionOptions.feeIncrease);
   });
});
