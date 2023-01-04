import { expect } from "chai";
import { AssetManagerSettings } from "../../../src/fasset/AssetManagerTypes";
import { Prices } from "../../../src/state/Prices";
import { toBNExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/utils/TestChainInfo";
import { disableMccTraceManager } from "../../utils/helpers";
import { createTestAssetContext, TestAssetBotContext } from "../../utils/test-asset-context";


describe("Prices tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let settings: AssetManagerSettings;

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp, false);
        settings = await context.assetManager.getSettings();
    });

    it("Should create Prices object", async () => {
        await context.natFtso.setCurrentPrice(100, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        const { 0: natPrice, 1: natTimestamp } = await context.natFtso.getCurrentPrice();
        const { 0: assetPrice, 1: assetTimestamp } = await context.assetFtso.getCurrentPrice();
        const prices = new Prices(settings, natPrice, natTimestamp, assetPrice, assetTimestamp);
        expect(typeof prices).to.eq("object");
        expect(prices.toString()).to.eq("(nat=0.001$, asset=10.000$, asset/nat=10000.000)");
        expect(prices.natUSD).to.eq(0.001);
        expect(prices.assetUSD).to.eq(10);
        expect(prices.assetNat).to.eq(10000);
    })

});