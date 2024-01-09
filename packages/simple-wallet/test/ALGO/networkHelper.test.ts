import { WALLET } from "../../src";
import { expect } from "chai";
import type { AlgoRpcConfig } from "../../src/interfaces/WriteWalletRpcInterface";
import { requireEnv } from "../../src/utils/utils";

describe("Algo wallet connection tests", () => {
   it("Should create connection", async () => {
      const connection: AlgoRpcConfig = {
         url: requireEnv("ALGO_ALGOD_URL"),
         apiTokenKey: "ApiTokenKey",
         rateLimitOptions: {},
      };
      const wClient = new WALLET.ALGO(connection);
      expect(wClient.inTestnet).to.eq(false);
   });

   it("Should create connection 2", async () => {
      const connection: AlgoRpcConfig = {
         url: requireEnv("ALGO_ALGOD_URL"),
         username: "user",
         password: "pass",
         inTestnet: true,
         rateLimitOptions: { timeoutMs: 2000 },
      };
      const wClient = new WALLET.ALGO(connection);
      expect(wClient.inTestnet).to.eq(true);
   });
});
