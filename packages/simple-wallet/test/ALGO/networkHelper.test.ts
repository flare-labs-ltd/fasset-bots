import { WALLET } from "../../src";
import { expect } from "chai";
import type { AlgoWalletConfig } from "../../src/interfaces/WriteWalletInterface";
import { requireEnv } from "../../src/utils/utils";

describe("Algo wallet connection tests", () => {
   it("Should create connection", async () => {
      const connection: AlgoWalletConfig = {
         url: requireEnv("ALGO_ALGOD_URL"),
         apiTokenKey: "ApiTokenKey",
         rateLimitOptions: {},
      };
      const wClient = await WALLET.ALGO.initialize(connection);
      expect(wClient.inTestnet).to.eq(false);
   });

   it("Should create connection 2", async () => {
      const connection: AlgoWalletConfig = {
         url: requireEnv("ALGO_ALGOD_URL"),
         username: "user",
         password: "pass",
         inTestnet: true,
         rateLimitOptions: { timeoutMs: 2000 },
      };
      const wClient = await WALLET.ALGO.initialize(connection);
      expect(wClient.inTestnet).to.eq(true);
   });
});
