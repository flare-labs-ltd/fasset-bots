import { expect } from "chai";
import { WALLET } from "../../src";
import { BTC_MAINNET, BTC_TESTNET } from "../../src/utils/constants";
import { getCurrentNetwork } from "../../src/utils/utils";

describe("Bitcoin network helper tests", () => {
   it("Should switch to mainnet", async () => {
      const BTCMccConnectionMain = {
         url: process.env.BTC_URL ?? "",
         username: "",
         password: "",
         rateLimitOptions: {
            timeoutMs: 15000,
         },
      };
      const wClient: WALLET.BTC = new WALLET.BTC(BTCMccConnectionMain);
      const currentNetwork = getCurrentNetwork(wClient.chainType);
      expect(currentNetwork).to.eql(BTC_MAINNET);
   });

   it("Should switch to testnet", async () => {
      const BTCMccConnectionTest = {
         url: process.env.BTC_URL ?? "",
         username: "",
         password: "",
         inTestnet: true,
      };
      const wClient: WALLET.BTC = new WALLET.BTC(BTCMccConnectionTest);
      const currentNetwork = getCurrentNetwork(wClient.chainType);
      expect(currentNetwork).to.eql(BTC_TESTNET);
   });

   it("Should create config with username and password to testnet", async () => {
      const BTCMccConnectionTest = {
         url: process.env.BTC_URL ?? "",
         username: "username",
         password: "password",
         inTestnet: true,
      };
      const wClient: WALLET.BTC = new WALLET.BTC(BTCMccConnectionTest);
      expect(wClient.client.defaults.auth).to.not.be.undefined;
   });
});
