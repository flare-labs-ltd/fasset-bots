import { expect } from "chai";
import { AssetManagerSettings, CollateralToken, CollateralTokenClass } from "../../../src/fasset/AssetManagerTypes";
import { Prices } from "../../../src/state/Prices";
import { toBIPS, toBN, toBNExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { TestAssetBotContext } from "../../test-utils/create-test-asset-context";
import { createTestContext } from "../../test-utils/helpers";
import { TokenPrice, TokenPriceReader } from "../../../src/state/TokenPrice";
import { AMGPrice, CollateralPrice } from "../../../src/state/CollateralPrice";
import { artifacts } from "../../../src/utils/artifacts";

const IFtsoRegistry = artifacts.require("IFtsoRegistry");
const setMaxTrustedPriceAgeSeconds = 1;
const amgSettings = {
    assetMintingDecimals: 6,
    assetMintingGranularityUBA: 1
}
const AMG_TO_TOKEN_WEI = toBNExp(1, 9)
const price = toBN(123456);
const timestamp = toBN(123);
const decimals = toBN(6);
const poolCollateral: CollateralToken = {
    tokenClass: CollateralTokenClass.POOL,
    token: "address",
    decimals: 18,
    validUntil: 0,  // not deprecated
    directPricePair: false,
    assetFtsoSymbol: "XRP",
    tokenFtsoSymbol: "NAT",
    minCollateralRatioBIPS: toBIPS(2.2),
    ccbMinCollateralRatioBIPS: toBIPS(1.9),
    safetyMinCollateralRatioBIPS: toBIPS(2.3),
};

describe("Prices tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let settings: AssetManagerSettings;
    let ftsoRegistry;
    let priceReader: TokenPriceReader;
    let assetPrice: TokenPrice;
    let tokenPrice: TokenPrice;
    let amgPrice: AMGPrice;
    let collateralPrice: CollateralPrice;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        context = await createTestContext(accounts[0], setMaxTrustedPriceAgeSeconds);
        settings = await context.assetManager.getSettings();
        ftsoRegistry = await IFtsoRegistry.at(settings.ftsoRegistry);
        priceReader = new TokenPriceReader(ftsoRegistry);
        assetPrice = new TokenPrice(price, timestamp, decimals);
        tokenPrice = assetPrice;
        amgPrice = new AMGPrice(AMG_TO_TOKEN_WEI, toBN(amgSettings.assetMintingDecimals), toBN(amgSettings.assetMintingGranularityUBA));
        collateralPrice = new CollateralPrice(poolCollateral, assetPrice, tokenPrice, amgPrice);
    });

    it("Should create Prices", async () => {
        const prices = new Prices([collateralPrice]);
        expect(prices.isPoolCollateral(collateralPrice.collateral)).to.be.true;
        expect(prices.natPrice).to.not.be.null;
    });

    it("Should return Prices", async () => {
        const prices = await Prices.getPrices(context, settings, [collateralPrice.collateral]);
        expect(prices.length).to.eq(2);
    });

    it("Should return Ftso prices", async () => {
        const prices = await Prices.getFtsoPrices(priceReader, settings, [collateralPrice.collateral]);
        expect(prices.isPoolCollateral(collateralPrice.collateral)).to.be.true;
        expect(prices.natPrice).to.not.be.null;
    });

});