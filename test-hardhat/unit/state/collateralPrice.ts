import { toBIPS, toBN, toBNExp } from "../../../src/utils/helpers";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
import { AMGPrice, CollateralPrice } from "../../../src/state/CollateralPrice";
import { web3 } from "../../../src/utils/web3";
import { createTestAssetContext } from "../../test-utils/create-test-asset-context";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { AssetManagerSettings, CollateralToken, CollateralTokenClass } from "../../../src/fasset/AssetManagerTypes";
import { TokenPrice, TokenPriceReader } from "../../../src/state/TokenPrice";
import { artifacts } from "../../../src/utils/artifacts";
use(chaiAsPromised);

const IFtsoRegistry = artifacts.require("IFtsoRegistry");
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

    it("Should calculate conversions", async () => {
        const amgPrice = new AMGPrice(AMG_TO_TOKEN_WEI, toBN(amgSettings.assetMintingDecimals), toBN(amgSettings.assetMintingGranularityUBA));
        const valueAMG0 = toBN(100);
        const valueUBA0 = amgPrice.convertAmgToUBA(valueAMG0);
        expect(valueAMG0.eq(valueUBA0)).to.be.true;

        const valueUBA1 = toBN(100);
        const valueAMG1 = amgPrice.convertUBAToAmg(valueUBA1);
        expect(valueAMG1.eq(valueUBA1)).to.be.true;

        const amgToTokenWei = amgPrice.convertAmgToTokenWei(valueAMG0);
        expect(amgToTokenWei.eq(valueAMG0)).to.be.true;

        const valueNATWei = toBN(100);
        const tokenWeiToAmg = amgPrice.convertTokenWeiToAMG(valueNATWei);
        expect(valueNATWei.eq(tokenWeiToAmg)).to.be.true;

        const ubaToTokenWei = amgPrice.convertUBAToTokenWei(valueAMG0);
        expect(ubaToTokenWei.eq(valueAMG0)).to.be.true;

        const valueUBA2 = amgPrice.convertTokenWeiToUBA(valueNATWei);
        expect(valueNATWei.eq(valueUBA2)).to.be.true;
    });

});

describe("Collateral price unit tests", async () => {
    let settings: AssetManagerSettings;
    let ftsoRegistry;
    let priceReader: TokenPriceReader;
    let assetPrice: TokenPrice;
    let tokenPrice: TokenPrice;
    let amgPrice: AMGPrice;

    before(async () => {
        const accounts = await web3.eth.getAccounts();
        const context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        settings = await context.assetManager.getSettings();
        ftsoRegistry = await IFtsoRegistry.at(settings.ftsoRegistry);
        priceReader = new TokenPriceReader(ftsoRegistry);
        assetPrice = new TokenPrice(price, timestamp, decimals);
        tokenPrice = assetPrice;
        amgPrice = new AMGPrice(AMG_TO_TOKEN_WEI, toBN(amgSettings.assetMintingDecimals), toBN(amgSettings.assetMintingGranularityUBA));
    });

    it("Should create CollateralPrice", async () => {
        const collateralPrice0 = new CollateralPrice(poolCollateral, assetPrice, tokenPrice, amgPrice);
        expect(collateralPrice0.assetPrice.decimals.eq(assetPrice.decimals));
        expect(collateralPrice0.amgPrice.amgToTokenWei.eq(amgPrice.amgToTokenWei));

        const collateralPrice1 = CollateralPrice.forTokenPrices(amgSettings, poolCollateral, assetPrice, tokenPrice);
        expect(collateralPrice1.assetPrice.decimals.eq(assetPrice.decimals));
        expect(collateralPrice1.amgPrice.amgToTokenWei.eq(amgPrice.amgToTokenWei));

        const collateralPrice2 = await CollateralPrice.forCollateral(priceReader, settings, poolCollateral);
        expect(collateralPrice2.assetPrice.decimals.eq(assetPrice.decimals));
        expect(collateralPrice2.amgPrice.amgToTokenWei.eq(amgPrice.amgToTokenWei));
    });

    it("Should calculate conversions", async () => {
        const collateralPrice0 = new CollateralPrice(poolCollateral, assetPrice, tokenPrice, amgPrice);
        const valueAMG0 = toBN(100);
        const valueUBA0 = collateralPrice0.convertAmgToUBA(valueAMG0);
        expect(valueAMG0.eq(valueUBA0)).to.be.true;

        const valueUBA1 = toBN(100);
        const valueAMG1 = collateralPrice0.convertUBAToAmg(valueUBA1);
        expect(valueAMG1.eq(valueUBA1)).to.be.true;

        const amgToTokenWei = collateralPrice0.convertAmgToTokenWei(valueAMG0);
        expect(amgToTokenWei.eq(valueAMG0)).to.be.true;

        const valueNATWei = toBN(100);
        const tokenWeiToAmg = collateralPrice0.convertTokenWeiToAMG(valueNATWei);
        expect(valueNATWei.eq(tokenWeiToAmg)).to.be.true;

        const ubaToTokenWei = collateralPrice0.convertUBAToTokenWei(valueAMG0);
        expect(ubaToTokenWei.eq(valueAMG0)).to.be.true;

        const valueUBA2 = collateralPrice0.convertTokenWeiToUBA(valueNATWei);
        expect(valueNATWei.eq(valueUBA2)).to.be.true;
    });

});