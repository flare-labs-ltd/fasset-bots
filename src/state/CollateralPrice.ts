import { AssetManagerSettings, CollateralType } from "../fasset/AssetManagerTypes";
import { AMGSettings, amgToTokenWeiPrice, convertAmgToTokenWei, convertUBAToTokenWei } from "../fasset/Conversions";
import { BNish, toBN } from "../utils/helpers";
import { TokenPrice, TokenPriceReader } from "./TokenPrice";

export class AMGPrice {
    constructor(
        public amgToTokenWei: BN,
        public assetMintingDecimals: BN,
        public assetMintingGranularityUBA: BN,
    ) {
    }

    convertAmgToTokenWei(valueAMG: BNish) {
        return convertAmgToTokenWei(valueAMG, this.amgToTokenWei);
    }


    convertUBAToTokenWei(valueUBA: BNish) {
        return convertUBAToTokenWei(this, valueUBA, this.amgToTokenWei);
    }

    static forAmgPrice(settings: AMGSettings, amgToTokenWei: BN) {
        return new AMGPrice(amgToTokenWei, toBN(settings.assetMintingDecimals), toBN(settings.assetMintingGranularityUBA));
    }

    static forTokenPrices(settings: AMGSettings, collateral: CollateralType, assetPrice: TokenPrice, tokenPrice: TokenPrice | undefined) {
        const [tokPrice, tokPriceDecimals] = collateral.directPricePair ? [1, 0] : [tokenPrice!.price, tokenPrice!.decimals];
        const amgToTokenWei = amgToTokenWeiPrice(settings, collateral.decimals, tokPrice, tokPriceDecimals, assetPrice.price, assetPrice.decimals);
        return new AMGPrice(amgToTokenWei, toBN(settings.assetMintingDecimals), toBN(settings.assetMintingGranularityUBA));
    }
}

export abstract class AMGPriceConverter {
    abstract amgPrice: AMGPrice;

    convertAmgToTokenWei(valueAMG: BNish) {
        return this.amgPrice.convertAmgToTokenWei(valueAMG);
    }

    convertUBAToTokenWei(valueUBA: BNish) {
        return this.amgPrice.convertUBAToTokenWei(valueUBA);
    }
}

export class CollateralPrice extends AMGPriceConverter {
    constructor(
        public collateral: CollateralType,
        public assetPrice: TokenPrice,
        public tokenPrice: TokenPrice | undefined,
        public amgPrice: AMGPrice,
    ) {
        super();
    }

    static async forCollateral(priceReader: TokenPriceReader, settings: AssetManagerSettings, collateral: CollateralType, trusted: boolean = false) {
        const assetPrice = await priceReader.getPrice(collateral.assetFtsoSymbol, trusted, settings.maxTrustedPriceAgeSeconds);
        const tokenPrice = collateral.tokenFtsoSymbol ? await priceReader.getPrice(collateral.tokenFtsoSymbol, trusted, settings.maxTrustedPriceAgeSeconds) : undefined;
        const amgPrice = AMGPrice.forTokenPrices(settings, collateral, assetPrice, tokenPrice);
        return new CollateralPrice(collateral, assetPrice, tokenPrice, amgPrice);
    }
}
