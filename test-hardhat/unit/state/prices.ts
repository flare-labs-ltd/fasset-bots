import { expect } from "chai";
import { AssetManagerSettings } from "../../../src/fasset/AssetManagerTypes";
import { Prices } from "../../../src/state/Prices";
import { sleep, toBNExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/utils/TestChainInfo";
import { createTestAssetContext, TestAssetBotContext } from "../../utils/test-asset-context";
import fs from "fs";

const setMaxTrustedPriceAgeSeconds = 1;

async function createContext(governance: string, setMaxTrustedPriceAgeSeconds: Number) {
    const parameterFilename = `../fasset/deployment/config/hardhat/f-${testChainInfo.xrp.symbol.toLowerCase()}.json`;
    const parameters = JSON.parse(fs.readFileSync(parameterFilename).toString());
    parameters.maxTrustedPriceAgeSeconds = setMaxTrustedPriceAgeSeconds;
    return  await createTestAssetContext(governance, testChainInfo.xrp, false, undefined, parameters);
}

describe("Prices tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let settings: AssetManagerSettings;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        context = await createContext(accounts[0], setMaxTrustedPriceAgeSeconds);
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
    });

    it("Should refresh Prices", async () => {
        await context.natFtso.setCurrentPrice(100, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        const { 0: natPrice, 1: natTimestamp } = await context.natFtso.getCurrentPrice();
        const { 0: assetPrice, 1: assetTimestamp } = await context.assetFtso.getCurrentPrice();
        const prices = new Prices(settings, natPrice, natTimestamp, assetPrice, assetTimestamp);
        await sleep(setMaxTrustedPriceAgeSeconds * 1000);
        const refresh = prices.fresh(prices, setMaxTrustedPriceAgeSeconds);
        expect(refresh).to.be.true;
    });

    it("Should get Prices", async () => {
        await context.natFtso.setCurrentPrice(100, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        await context.natFtso.setCurrentPriceFromTrustedProviders(100, 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(10, 5), 0);
        const prices = await Prices.getPrices(context, settings);
        expect(prices.length).to.eq(2);
        expect(prices[0].natUSD).to.eq(0.001);
        expect(prices[0].assetUSD).to.eq(10);
        expect(prices[0].assetNat).to.eq(10000);
        expect(prices[1].natUSD).to.eq(0.001);
        expect(prices[1].assetUSD).to.eq(10);
        expect(prices[1].assetNat).to.eq(10000);
    });

});