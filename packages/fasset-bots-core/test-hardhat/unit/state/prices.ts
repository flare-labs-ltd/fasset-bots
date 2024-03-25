import { expect } from "chai";
import { AssetManagerSettings, CollateralType, CollateralClass } from "../../../src/fasset/AssetManagerTypes";
import { Prices } from "../../../src/state/Prices";
import { toBIPS, toBN, toBNExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { TestAssetBotContext } from "../../test-utils/create-test-asset-context";
import { createTestContext } from "../../test-utils/helpers";
import { TokenPrice, TokenPriceReader } from "../../../src/state/TokenPrice";
import { AMGPrice, CollateralPrice } from "../../../src/state/CollateralPrice";
import { CollateralIndexedList } from "../../../src/state/CollateralIndexedList";

const setMaxTrustedPriceAgeSeconds = 1;
const amgSettings = {
    assetMintingDecimals: 6,
    assetMintingGranularityUBA: 1,
};
const AMG_TO_TOKEN_WEI = toBNExp(1, 9);
const price = toBN(123456);
const timestamp = toBN(123);
const decimals = toBN(6);
const poolCollateral: CollateralType = {
    collateralClass: CollateralClass.POOL,
    token: "address",
    decimals: 18,
    validUntil: 0, // not deprecated
    directPricePair: false,
    assetFtsoSymbol: "XRP",
    tokenFtsoSymbol: "NAT",
    minCollateralRatioBIPS: toBIPS(2.2),
    ccbMinCollateralRatioBIPS: toBIPS(1.9),
    safetyMinCollateralRatioBIPS: toBIPS(2.3),
};

describe("Prices tests", () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let settings: AssetManagerSettings;
    let priceReader: TokenPriceReader;
    let assetPrice: TokenPrice;
    let tokenPrice: TokenPrice;
    let amgPrice: AMGPrice;
    let collateralPrice: CollateralPrice;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        context = await createTestContext(accounts[0], setMaxTrustedPriceAgeSeconds);
        settings = await context.assetManager.getSettings();
        priceReader = await TokenPriceReader.create(settings);
        assetPrice = new TokenPrice(price, timestamp, decimals);
        tokenPrice = assetPrice;
        amgPrice = new AMGPrice(AMG_TO_TOKEN_WEI, toBN(amgSettings.assetMintingDecimals), toBN(amgSettings.assetMintingGranularityUBA));
        collateralPrice = new CollateralPrice(poolCollateral, assetPrice, tokenPrice, amgPrice);
    });

    it("Should return Prices", async () => {
        const prices = await Prices.getPrices(settings, [collateralPrice.collateral]);
        expect(prices.length).to.eq(2);
    });

    it("Should print prices", async () => {
        const collateralPrices = new CollateralIndexedList<CollateralPrice>();
        const collateralPrice = await CollateralPrice.forCollateral(priceReader, settings, poolCollateral);
        collateralPrices.set(poolCollateral, collateralPrice);
        const prices = new Prices(collateralPrices);
        expect(prices.toString().length).to.be.gt(1);

        const poolCollateralPair = Object.assign({}, poolCollateral);
        poolCollateralPair.directPricePair = true;
        const collateralPricesPair = new CollateralIndexedList<CollateralPrice>();
        const collateralPricePair = await CollateralPrice.forCollateral(priceReader, settings, poolCollateralPair);
        collateralPricesPair.set(poolCollateralPair, collateralPricePair);
        const pricesPair = new Prices(collateralPricesPair);
        expect(pricesPair.toString().length).to.be.gt(1);
    });
});
