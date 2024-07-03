import { expect } from "chai";
import { WALLET } from "../../src";
import { ChainType, DEFAULT_RATE_LIMIT_OPTIONS, DOGE_MAINNET, DOGE_TESTNET } from "../../src/utils/constants";
import { getCurrentNetwork } from "../../src/utils/utils";

describe("Dogecoin network helper tests", () => {
   it("Should switch to mainnet", async () => {
      const DOGEMccConnectionMain = {
         url: process.env.DOGE_URL ?? "",
         username: "",
         password: "",
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
      };
      const wClient = await WALLET.DOGE.initialize(DOGEMccConnectionTest);
      expect(wClient.client.defaults.timeout).to.eq(DEFAULT_RATE_LIMIT_OPTIONS.timeoutMs);
      expect(wClient.blockOffset).to.eq(DOGEMccConnectionTest.stuckTransactionOptions.blockOffset);
      expect(wClient.maxRetries).to.eq(DOGEMccConnectionTest.stuckTransactionOptions.retries);
      expect(wClient.feeIncrease).to.eq(DOGEMccConnectionTest.stuckTransactionOptions.feeIncrease);
   });
});
