import { expect } from "chai";
import { WALLET } from "../../src";
import { DEFAULT_RATE_LIMIT_OPTIONS, DOGE_MAINNET, DOGE_TESTNET } from "../../src/utils/constants";
import { getCurrentNetwork } from "../../src/utils/utils";

describe("Dogecoin network helper tests", () => {
   it("Should switch to mainnet", async () => {
      const DOGEMccConnectionMain = {
         url: process.env.DOGE_URL ?? "",
         username: "",
         password: "",
         walletSecret: "wallet_secret"
      };
      const wClient: WALLET.DOGE = await WALLET.DOGE.initialize(DOGEMccConnectionMain);
      const currentNetwork = getCurrentNetwork(wClient.chainType);
      expect(currentNetwork).to.eql(DOGE_MAINNET);
   });

   it("Should switch to testnet", async () => {
      const DOGEMccConnectionTest = {
         url: process.env.DOGE_URL ?? "",
         username: "",
         password: "",
         inTestnet: true,
         walletSecret: "wallet_secret"
      };
      const wClient: WALLET.DOGE = await WALLET.DOGE.initialize(DOGEMccConnectionTest);
      const currentNetwork = getCurrentNetwork(wClient.chainType);
      expect(currentNetwork).to.eql(DOGE_TESTNET);
   });

   it("Should create config with predefined 'stuckTransactionConstants'", async () => {
      const DOGEMccConnectionTest = {
         url: process.env.DOGE_URL ?? "",
         username: "",
         password: "",
         inTestnet: true, stuckTransactionOptions: { blockOffset: 10, retries: 5, feeIncrease: 4 },
         walletSecret: "wallet_secret"
      };
      const wClient = await WALLET.DOGE.initialize(DOGEMccConnectionTest);
      expect(wClient.client.defaults.timeout).to.eq(DEFAULT_RATE_LIMIT_OPTIONS.timeoutMs);
   });
});
