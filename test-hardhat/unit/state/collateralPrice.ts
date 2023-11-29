import { toBIPS, toBN, toBNExp } from "../../../src/utils/helpers";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
import { AMGPrice, CollateralPrice } from "../../../src/state/CollateralPrice";
import { web3 } from "../../../src/utils/web3";
import { createTestAssetContext } from "../../test-utils/create-test-asset-context";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { AssetManagerSettings, CollateralType, CollateralClass } from "../../../src/fasset/AssetManagerTypes";
import { TokenPrice, TokenPriceReader } from "../../../src/state/TokenPrice";
use(chaiAsPromised);

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
    directPricePair: true,
    assetFtsoSymbol: "XRP",
    tokenFtsoSymbol: "",
    minCollateralRatioBIPS: toBIPS(2.2),
    ccbMinCollateralRatioBIPS: toBIPS(1.9),
    safetyMinCollateralRatioBIPS: toBIPS(2.3),
};

describe("AMG price unit tests", async () => {
    it("Should create AMGPrice", async () => {
        const amgPrice = new AMGPrice(AMG_TO_TOKEN_WEI, toBN(amgSettings.assetMintingDecimals), toBN(amgSettings.assetMintingGranularityUBA));
        expect(amgPrice.amgToTokenWei.eq(AMG_TO_TOKEN_WEI)).to.be.true;
    });
});

describe("Collateral price unit tests", async () => {
    let settings: AssetManagerSettings;
    let priceReader: TokenPriceReader;
    let assetPrice: TokenPrice;
    let tokenPrice: TokenPrice;
    let amgPrice: AMGPrice;

    before(async () => {
        const accounts = await web3.eth.getAccounts();
        const context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        settings = await context.assetManager.getSettings();
        priceReader = await TokenPriceReader.create(settings);
        assetPrice = new TokenPrice(price, timestamp, decimals);
        tokenPrice = assetPrice;
        amgPrice = new AMGPrice(AMG_TO_TOKEN_WEI, toBN(amgSettings.assetMintingDecimals), toBN(amgSettings.assetMintingGranularityUBA));
    });

    it("Should create CollateralPrice", async () => {
        const collateralPrice0 = new CollateralPrice(poolCollateral, assetPrice, tokenPrice, amgPrice);
        expect(collateralPrice0.assetPrice.decimals.eq(assetPrice.decimals));
        expect(collateralPrice0.amgPrice.amgToTokenWei.eq(amgPrice.amgToTokenWei));

        const collateralPrice2 = await CollateralPrice.forCollateral(priceReader, settings, poolCollateral);
        expect(collateralPrice2.assetPrice.decimals.eq(assetPrice.decimals));
        expect(collateralPrice2.amgPrice.amgToTokenWei.eq(amgPrice.amgToTokenWei));
    });
});
