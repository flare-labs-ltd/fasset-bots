import { TokenPrice, TokenPriceReader } from "../../../src/state/TokenPrice";
import { toBN } from "../../../src/utils/helpers";
import { createTestAssetContext } from "../../test-utils/create-test-asset-context";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { artifacts } from "../../../src/utils/artifacts";
import { AssetManagerSettings } from "../../../src/fasset/AssetManagerTypes";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);

const IFtsoRegistry = artifacts.require("IFtsoRegistry");

describe("Token price unit tests", async () => {

    it("Should create TokenPrice", async () => {
        const price = toBN(123456);
        const timestamp = toBN(123);
        const decimals = toBN(6);
        const tokenPrice = new TokenPrice(price, timestamp, decimals);
        expect(tokenPrice).to.not.be.null;
    });

});

describe("Token price reader unit tests", async () => {
    let settings: AssetManagerSettings;

    before(async () => {
        const accounts = await web3.eth.getAccounts();
        const context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        settings = await context.assetManager.getSettings();
    });

    it("Should create TokenPriceReader", async () => {
        const ftsoRegistry = await IFtsoRegistry.at(settings.ftsoRegistry);
        const priceReader = new TokenPriceReader(ftsoRegistry);
        expect(priceReader).to.not.be.null;
    });

    it("Should return Ftso", async () => {
        const ftsoRegistry = await IFtsoRegistry.at(settings.ftsoRegistry);
        const priceReader = new TokenPriceReader(ftsoRegistry);
        const ftsoSymbol = "NAT";
        const ftso = await priceReader.getFtso(ftsoSymbol);
        expect(await ftso.symbol()).to.eq(ftsoSymbol);
        await expect(priceReader.getFtso("NOT")).to.eventually.be.rejected.and.be.an.instanceOf(Error);
    });

    it("Should return price", async () => {
        const ftsoRegistry = await IFtsoRegistry.at(settings.ftsoRegistry);
        const priceReader = new TokenPriceReader(ftsoRegistry);
        const ftsoSymbol = "NAT";
        const price0 = await priceReader.getPrice(ftsoSymbol);
        const price1 = await priceReader.getPrice(ftsoSymbol, false, toBN(0));
        const price2 = await priceReader.getPrice(ftsoSymbol, true, toBN(0));
        expect(price0.toString()).to.not.be.null;
        expect(price1.toString()).to.not.be.null;
        expect(price2.toString()).to.not.be.null;
    });

});