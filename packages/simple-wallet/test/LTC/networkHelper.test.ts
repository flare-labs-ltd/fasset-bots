import { expect } from "chai";
import { WALLET } from "../../src";
import { LTC_MAINNET, LTC_TESTNET } from "../../src/utils/constants";
import { getCurrentNetwork } from "../../src/utils/utils";

describe("Litecoin network helper tests", () => {
   it("Should switch to mainnet", async () => {
      const LTCMccConnectionMain = {
         url: process.env.LTC_URL ?? "",
         username: "",
         password: "",
      };
      const wClient: WALLET.LTC = new WALLET.LTC(LTCMccConnectionMain);
      const currentNetwork = getCurrentNetwork(wClient.chainType);
      expect(currentNetwork).to.eql(LTC_MAINNET);
   });

   it("Should switch to testnet", async () => {
      const LTCMccConnectionTest = {
         url: process.env.LTC_URL ?? "",
         username: "",
         password: "",
         inTestnet: true,
      };
      const wClient: WALLET.LTC = new WALLET.LTC(LTCMccConnectionTest);
      const currentNetwork = getCurrentNetwork(wClient.chainType);
      expect(currentNetwork).to.eql(LTC_TESTNET);
   });
});
