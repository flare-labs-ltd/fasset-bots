import { TokenPriceReader } from "../state/TokenPrice";
import { AssetManagerSettings } from "./AssetManagerTypes";

export const POOL_TOKEN_DECIMALS = 18;

export enum CollateralKind { VAULT, POOL, AGENT_POOL_TOKENS }

export class CollateralDataFactory {
    constructor(
        public settings: AssetManagerSettings,
        public priceReader: TokenPriceReader
    ) { }

    static async create(settings: AssetManagerSettings) {
        const priceReader = await TokenPriceReader.create(settings);
        return new CollateralDataFactory(settings, priceReader);
    }

}
