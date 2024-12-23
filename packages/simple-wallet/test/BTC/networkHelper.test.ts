import { expect } from "chai";
import { BTC_MAINNET, BTC_TESTNET } from "../../src/utils/constants";
import { initializeTestMikroORM } from "../test-orm/mikro-orm.config";
import { UnprotectedDBWalletKeys } from "../test-orm/UnprotectedDBWalletKey";
import { getCurrentNetwork } from "../../src/chain-clients/utxo/UTXOUtils";
import { BTC } from "../../src";

describe("Bitcoin network helper tests", () => {
   it("Should switch to mainnet", async () => {
      const BTCMccConnectionMainInitial = {
         urls: [process.env.BTC_URL ?? ""],
         rateLimitOptions: {
            timeoutMs: 15000,
         },
      };
      const testOrm = await initializeTestMikroORM();
      const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
      const BTCMccConnectionMain = { ...BTCMccConnectionMainInitial, em: testOrm.em, walletKeys: unprotectedDBWalletKeys };
      const wClient: BTC = new BTC(BTCMccConnectionMain, {});
      const currentNetwork = getCurrentNetwork(wClient.chainType);
      expect(currentNetwork).to.eql(BTC_MAINNET);
   });

   it("Should switch to testnet", async () => {
      const BTCMccConnectionTestInitial = {
         urls: [process.env.BTC_URL ?? ""],
         inTestnet: true,

      };
      const testOrm = await initializeTestMikroORM();
      const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
      const BTCMccConnectionTest = { ...BTCMccConnectionTestInitial, em: testOrm.em, walletKeys: unprotectedDBWalletKeys };
      const wClient: BTC = BTC.initialize(BTCMccConnectionTest);
      const currentNetwork = getCurrentNetwork(wClient.chainType);
      expect(currentNetwork).to.eql(BTC_TESTNET);
   });

   it("Should check monitoring", async () => {
      const BTCMccConnectionTestInitial = {
         urls: [process.env.BTC_URL ?? ""],
         inTestnet: true,

      };
      const testOrm = await initializeTestMikroORM();
      const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
      const BTCMccConnectionTest = { ...BTCMccConnectionTestInitial, em: testOrm.em, walletKeys: unprotectedDBWalletKeys };
      const wClient: BTC = BTC.initialize(BTCMccConnectionTest);
      const monitor = await wClient.createMonitor();
      const isMonitoring = monitor.isMonitoring();
      const liveMonitor = await monitor.runningMonitorId();
      expect(isMonitoring).to.be.false;
      expect(liveMonitor).to.be.null;
   });

});
