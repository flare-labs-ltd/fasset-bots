import { IFtsoRegistryInstance } from "../../typechain-truffle";
import { AssetManagerSettings, CollateralType } from "../fasset/AssetManagerTypes";
import { IFtsoRegistryEvents } from "../fasset/IAssetContext";
import { ContractWithEvents } from "../utils/events/truffle";
import { CollateralIndexedList, CollateralTypeId } from "./CollateralIndexedList";
import { CollateralPrice } from "./CollateralPrice";
import { TokenPrice, TokenPriceReader } from "./TokenPrice";

export type StablecoinPrices = { [tokenAddress: string]: TokenPrice };

export class Prices {
    constructor(
        public collateralPrices: CollateralIndexedList<CollateralPrice>,
    ) { }

    get(token: CollateralTypeId) {
        return this.collateralPrices.get(token);
    }

    static async getFtsoPrices(priceReader: TokenPriceReader, settings: AssetManagerSettings, collaterals: Iterable<CollateralType>, trusted: boolean): Promise<Prices> {
        const collateralPrices = new CollateralIndexedList<CollateralPrice>();
        for (const collateral of collaterals) {
            const collateralPrice = await CollateralPrice.forCollateral(priceReader, settings, collateral, trusted);
            collateralPrices.set(collateral, collateralPrice);
        }
        return new Prices(collateralPrices);
    }

    static async getPrices(ftsoRegistry: ContractWithEvents<IFtsoRegistryInstance, IFtsoRegistryEvents>, settings: AssetManagerSettings, collaterals: Iterable<CollateralType>): Promise<[Prices, Prices]> {
        const priceReader = new TokenPriceReader(ftsoRegistry);
        const ftsoPrices = await this.getFtsoPrices(priceReader, settings, collaterals, false);
        const trustedPrices = await this.getFtsoPrices(priceReader, settings, collaterals, true);
        return [ftsoPrices, trustedPrices];
    }
}
