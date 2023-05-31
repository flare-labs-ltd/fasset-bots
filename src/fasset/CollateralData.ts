import { TokenPriceReader } from "../state/TokenPrice";
import { artifacts } from "../utils/artifacts";
import { AssetManagerSettings } from "./AssetManagerTypes";

export const POOL_TOKEN_DECIMALS = 18;

const IFtsoRegistry = artifacts.require("IFtsoRegistry") ;

export enum CollateralKind { CLASS1, POOL, AGENT_POOL_TOKENS }

export class CollateralDataFactory {
    constructor(
        public settings: AssetManagerSettings,
        public priceReader: TokenPriceReader
    ) { }

    static async create(settings: AssetManagerSettings) {
        const ftsoRegistry = await IFtsoRegistry.at(settings.ftsoRegistry);
        const priceReader = new TokenPriceReader(ftsoRegistry);
        return new CollateralDataFactory(settings, priceReader);
    }

}
