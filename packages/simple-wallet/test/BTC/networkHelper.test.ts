import { expect } from "chai";
import { initializeTestMikroORM } from "../test-orm/mikro-orm.config";
import { UnprotectedDBWalletKeys } from "../test-orm/UnprotectedDBWalletKey";
import { BTC } from "../../src";

describe("Bitcoin network helper tests", () => {

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
