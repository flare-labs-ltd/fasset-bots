import { CollateralData } from "../../test/test-utils/CollateralData";
import { CollateralPoolTokenInstance } from "../../typechain-truffle/CollateralPoolToken";
import { AMGPrice, CollateralPrice } from "../state/CollateralPrice";
import { TokenPrice, TokenPriceReader } from "../state/TokenPrice";
import { exp10 } from "../utils/helpers";
import { AssetManagerSettings, CollateralType } from "./AssetManagerTypes";
import { amgToTokenWeiPrice } from "./Conversions";

export const POOL_TOKEN_DECIMALS = 18;

export enum CollateralKind { CLASS1, POOL, AGENT_POOL_TOKENS }

export class CollateralDataFactory {
    constructor(
        public settings: AssetManagerSettings,
        public priceReader: TokenPriceReader
    ) { }

    static async create(settings: AssetManagerSettings) {
        const priceReader = await TokenPriceReader.create(settings);
        return new CollateralDataFactory(settings, priceReader);
    }

    async class1(collateral: CollateralType, agentVault: string) {
        return await this.forCollateral(collateral, agentVault);
    }

    async pool(collateral: CollateralType, collateralPoolAddress: string) {
        return await this.forCollateral(collateral, collateralPoolAddress);
    }

    async forCollateral(collateral: CollateralType, tokenHolder: string) {
        const collateralPrice = await CollateralPrice.forCollateral(this.priceReader, this.settings, collateral);
        return CollateralData.forCollateralPrice(collateralPrice, tokenHolder);
    }

    async agentPoolTokens(poolCollateral: CollateralData, poolToken: CollateralPoolTokenInstance, agentVault: string) {
        const agentPoolTokens = await poolToken.balanceOf(agentVault);
        const totalPoolTokens = await poolToken.totalSupply();
        // asset price and token price will be expressed in pool collateral (wnat)
        const assetPrice = poolCollateral.collateral!.directPricePair ? poolCollateral.assetPrice : poolCollateral.assetPrice.priceInToken(poolCollateral.tokenPrice!, 18);
        const tokenPrice = TokenPrice.fromFraction(poolCollateral.balance, totalPoolTokens, poolCollateral.assetPrice.timestamp, 18);
        const amgToTokenWei = tokenPrice.price.isZero()
            ? exp10(100)    // artificial price, shouldn't be used
            : amgToTokenWeiPrice(this.settings, POOL_TOKEN_DECIMALS, tokenPrice.price, tokenPrice.decimals, assetPrice.price, assetPrice.decimals);
        const amgPrice = AMGPrice.forAmgPrice(this.settings, amgToTokenWei);
        return new CollateralData(null, agentPoolTokens, assetPrice, tokenPrice, amgPrice);
    }
}
