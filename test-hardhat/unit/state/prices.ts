import { expect } from "chai";
import { AssetManagerSettings } from "../../../src/fasset/AssetManagerTypes";
import { Prices } from "../../../src/state/Prices";
import { sleep, toBN, toBNExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { TestAssetBotContext } from "../../test-utils/create-test-asset-context";
import { createTestContext } from "../../test-utils/helpers";
import { TokenPrice } from "../../../src/state/TokenPrice";

const setMaxTrustedPriceAgeSeconds = 1;
const class1TokenKey = "usdc";
const natFtsoPrice = 100;
const assetFtsoPrice = toBNExp(10, 5);

describe("Prices tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let settings: AssetManagerSettings;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        context = await createTestContext(accounts[0], setMaxTrustedPriceAgeSeconds);
        settings = await context.assetManager.getSettings();
    });

    it("Should create Prices object", async () => {
        await context.natFtso.setCurrentPrice(natFtsoPrice, 0);
        await context.assetFtso.setCurrentPrice(assetFtsoPrice, 0);
        const natUSD = await TokenPrice.forFtso(context.natFtso);
        const assetUSD = await TokenPrice.forFtso(context.assetFtso);
        const stablecoinUSD = await TokenPrice.forFtso(context.ftsos[class1TokenKey]);
        const class1Address = context.stablecoins[class1TokenKey].address;
        const prices = new Prices(settings, context.collaterals, natUSD, assetUSD, { [class1Address]: stablecoinUSD });
        expect(typeof prices).to.eq("object");
        expect(prices.natUSD.price.eqn(natFtsoPrice)).to.be.true;
        expect(prices.assetUSD.price.eq(assetFtsoPrice)).to.be.true;
        expect(Object.prototype.hasOwnProperty.call(prices.amgToClass1Wei, class1Address)).to.be.true;
    });

    it("Should refresh Prices", async () => {
        await context.natFtso.setCurrentPrice(natFtsoPrice, 0);
        const natUSD = await TokenPrice.forFtso(context.natFtso);
        await sleep(setMaxTrustedPriceAgeSeconds * 1000);
        const refresh = natUSD.fresh(natUSD, toBN(setMaxTrustedPriceAgeSeconds));
        expect(refresh).to.be.true;
    });

    it("Should get Prices", async () => {
        await context.natFtso.setCurrentPrice(natFtsoPrice, 0);
        await context.assetFtso.setCurrentPrice(assetFtsoPrice, 0);
        await context.natFtso.setCurrentPriceFromTrustedProviders(natFtsoPrice, 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(assetFtsoPrice, 0);
        const natUSD = await TokenPrice.forFtso(context.natFtso);
        const natUSDTrusted = await TokenPrice.forFtsoTrusted(context.natFtso, toBN(setMaxTrustedPriceAgeSeconds), natUSD);
        const assetUSD = await TokenPrice.forFtso(context.assetFtso);
        const assetUSDTrusted = await TokenPrice.forFtsoTrusted(context.assetFtso, toBN(setMaxTrustedPriceAgeSeconds), assetUSD);
        expect(natUSD.price.eqn(natFtsoPrice)).to.be.true;
        expect(natUSDTrusted.price.eqn(natFtsoPrice)).to.be.true;
        expect(assetUSD.price.eq(assetFtsoPrice)).to.be.true;
        expect(assetUSDTrusted.price.eq(assetFtsoPrice)).to.be.true;
    });

});