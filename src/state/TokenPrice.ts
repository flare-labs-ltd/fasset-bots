import { IERC20Instance, IFtsoInstance, IFtsoRegistryInstance } from "../../typechain-truffle";
import { artifacts } from "../utils/artifacts";
import { ContractWithEvents } from "../utils/events/truffle";
import { createFtsosHelper } from "../utils/fasset-helpers";
import { BNish, getOrCreateAsync, requireNotNull, toBN } from "../utils/helpers";
export type IERC20Events = import('../../typechain-truffle/IERC20').AllEvents;

const IFtso = artifacts.require('IFtso');
const IERC20 = artifacts.require('IERC20')

export async function tokenContract(tokenAddress: string) {
    return await IERC20.at(tokenAddress) as ContractWithEvents<IERC20Instance, IERC20Events>;
}

export async function tokenBalance(tokenAddress: string, owner: string) {
    const token = await IERC20.at(tokenAddress);
    return await token.balanceOf(owner);
}

export class TokenPrice {
    constructor(
        public readonly price: BN,
        public readonly timestamp: BN,
        public readonly decimals: BN
    ) {
    }

    fresh(relativeTo: TokenPrice, maxAge: BN) {
        return this.timestamp.add(maxAge).gte(relativeTo.timestamp);
    }
}

export class TokenPriceReader {
    ftsoCache: Map<string, IFtsoInstance> = new Map();
    priceCache: Map<string, TokenPrice> = new Map();

    constructor(
        public ftsoRegistry: IFtsoRegistryInstance
    ) { }

    getFtso(symbol: string) {
        return getOrCreateAsync(this.ftsoCache, symbol, async () => {
            return await createFtsosHelper(this.ftsoRegistry, symbol);
        });
    }

    getRawPrice(symbol: string, trusted: boolean) {
        return getOrCreateAsync(this.priceCache, `${symbol}::trusted=${trusted}`, async () => {
            const ftso = await this.getFtso(symbol);
            const { 0: price, 1: timestamp, 2: decimals } =
                trusted ? await ftso.getCurrentPriceWithDecimals() : await ftso.getCurrentPriceWithDecimalsFromTrustedProviders();
            return new TokenPrice(toBN(price), toBN(timestamp), toBN(decimals));
        });
    }

    async getPrice(symbol: string, trusted?: false): Promise<TokenPrice>;
    async getPrice(symbol: string, trusted: boolean, trustedMaxAge: BNish): Promise<TokenPrice>;
    async getPrice(symbol: string, trusted: boolean = false, trustedMaxAge?: BNish) {
        const ftsoPrice = await this.getRawPrice(symbol, false);
        if (trusted) {
            const trustedPrice = await this.getRawPrice(symbol, true);
            return trustedPrice.fresh(ftsoPrice, toBN(requireNotNull(trustedMaxAge))) ? trustedPrice : ftsoPrice;
        } else {
            return ftsoPrice;
        }
    }
}
