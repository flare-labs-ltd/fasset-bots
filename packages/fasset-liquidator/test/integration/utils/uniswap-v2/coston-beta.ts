import { WeiPerEther, Wallet, JsonRpcProvider, type Signer } from "ethers"
import { relativeTokenPrice, relativeTokenDexPrice } from "../../../calculations"
import { mulFactor } from "../../../utils"
import { waitFinalize } from "../finalization"
import { getContracts } from '../../utils/contracts'
import { removeLiquidity, safelyGetReserves } from "./wrappers"
import { syncDexReservesWithFtsoPrices } from "./price-sync"
import { FTSO_SYMBOLS } from "../../../constants"
import type { IERC20Metadata } from "../../../../types"
import type { Contracts } from "../interfaces/contracts"


type RelativeSpendings = {[symbol: string]: number | undefined}
type AbsoluteSpendings = {[symbol: string]: bigint}

export interface TokenInfo {
    contract: IERC20Metadata
    symbol: string
}

export class DexManipulator {
    public readonly symbols: { [symbol: string]: string }
    public readonly tokenPairs: [TokenInfo, TokenInfo][]

    constructor(
        public network: "coston",
        public provider: JsonRpcProvider,
        public signer: Signer,
        public contracts: Contracts
    ) {
        this.symbols = FTSO_SYMBOLS[network]
        this.tokenPairs = this.getPairsInfo()
    }

    public static async create(network: "coston", rpcUrl: string, assetManager: string, signerPrivateKey: string): Promise<DexManipulator> {
        const provider = new JsonRpcProvider(rpcUrl)
        const signer = new Wallet(signerPrivateKey, provider)
        const contracts = await getContracts(assetManager, network, provider)
        return new DexManipulator(network, provider, signer, contracts)
    }

    // adjust for new / different collaterals
    public get supportedCollaterals(): TokenInfo[] {
        return [
            { contract: this.contracts.collaterals.usdc, symbol: this.symbols.USDC },
            { contract: this.contracts.collaterals.usdt, symbol: this.symbols.USDT },
            { contract: this.contracts.collaterals.weth, symbol: this.symbols.WETH }
        ]
    }

    public async initDexes(relativeSpendings: RelativeSpendings = {}): Promise<void> {
        const spendings = await this.getAbsoluteSpendings(relativeSpendings, false)
        await this.syncOrInitDexes(true, spendings)
    }

    public async syncDexes(relativeSpendings: RelativeSpendings = {}): Promise<void> {
        const spendings = await this.getAbsoluteSpendings(relativeSpendings, true)
        await this.syncOrInitDexes(false, spendings)
    }

    public async removeAllLiquidity(): Promise<void> {
        for (let [tokenA, tokenB] of this.tokenPairs) {
            console.log(`removing liquidity from (${tokenA.symbol}, ${tokenB.symbol}) pool`)
            await removeLiquidity(this.contracts.uniswapV2, tokenA.contract, tokenB.contract, this.signer, this.provider)
        }
        await this.unwrapWNat()
    }

    public async wrapWNat(): Promise<void> {
        const leftoverNat = BigInt(10) * WeiPerEther // leave 10 NAT for gas
        const balanceNat = await this.provider.getBalance(this.signer)
        if (balanceNat > leftoverNat) {
            await waitFinalize(this.provider, this.signer, this.contracts.wNat.connect(this.signer).deposit({ value: balanceNat - leftoverNat }))
        }
    }

    public async unwrapWNat(): Promise<void> {
        const balanceWNat = await this.contracts.wNat.balanceOf(this.signer)
        if (balanceWNat > BigInt(0)) {
            await waitFinalize(this.provider, this.signer, this.contracts.wNat.connect(this.signer).withdraw(balanceWNat))
        }
    }

    public async getFtsoPriceForPair(symbolA: string, symbolB: string): Promise<bigint> {
        const { 0: priceA } = await this.contracts.priceReader.getPrice(symbolA)
        const { 0: priceB } = await this.contracts.priceReader.getPrice(symbolB)
        return relativeTokenPrice(priceA, priceB)
    }

    public async getDexPriceForPair(tokenA: IERC20Metadata, tokenB: IERC20Metadata): Promise<bigint> {
        const decimalsA = await tokenA.decimals()
        const decimalsB = await tokenB.decimals()
        const [reserveA, reserveB] = await safelyGetReserves(this.contracts.uniswapV2, tokenA, tokenB)
        return relativeTokenDexPrice(reserveA, reserveB, decimalsA, decimalsB)
    }

    public async displayDexReserves(): Promise<void> {
        for (const [tokenA, tokenB] of this.tokenPairs) {
            const [reserveA, reserveB] = await safelyGetReserves(this.contracts.uniswapV2, tokenA.contract, tokenB.contract)
            console.log(`dex reseves: ${reserveA} ${tokenA.symbol} / ${reserveB} ${tokenB.symbol}`)
        }
    }

    protected async syncOrInitDexes(init: boolean, maxSpent: AbsoluteSpendings): Promise<void> {
        for (const [tokenA, tokenB] of this.tokenPairs) {
            console.log(`syncing dex reserves with ftso prices on (${tokenA.symbol}, ${tokenB.symbol}) pool`)
            await syncDexReservesWithFtsoPrices(
                this.contracts.uniswapV2, this.contracts.priceReader,
                tokenA.contract, tokenB.contract, tokenA.symbol, tokenB.symbol,
                maxSpent[tokenA.symbol], maxSpent[tokenB.symbol],
                this.signer, this.provider, init)
        }
    }

    private getPairsInfo(): [TokenInfo, TokenInfo][] {
        const collaterals = this.supportedCollaterals
        const fAssetInfo = { contract: this.contracts.fAsset, symbol: this.symbols.TEST_XRP }
        const wNatInfo = { contract: this.contracts.wNat, symbol: this.symbols.WNAT }
        const pairs: [TokenInfo, TokenInfo][] = []
        for (const collateral of collaterals) {
            pairs.push([collateral, fAssetInfo])
            pairs.push([collateral, wNatInfo])
        }
        return pairs
    }

    // determine amounts of max tokens to be spent for each token from user's specified balance percentages
    // greedy determines whether to spend all tokens on a single pair or distribute them across all pairs
    private async getAbsoluteSpendings(config: RelativeSpendings, greedy: boolean): Promise<AbsoluteSpendings> {
        const maxSpent: AbsoluteSpendings = {}
        for (const pairs of this.tokenPairs) {
            for (const token of pairs) {
                if (maxSpent[token.symbol] === undefined) {
                    let maxSpentToken = await token.contract.balanceOf(this.signer)
                    const factor = config[token.symbol]
                    if (factor !== undefined) {
                        maxSpentToken = mulFactor(maxSpentToken, factor)
                    }
                    if (!greedy) {
                        maxSpentToken /= BigInt(this.numberOfPairsWithToken(token))
                    }
                    maxSpent[token.symbol] = maxSpentToken
                }
            }
        }
        return maxSpent
    }

    private numberOfPairsWithToken(token: TokenInfo): number {
        let counter = 0
        for (const [tokenA, tokenB] of this.tokenPairs) {
            if (token.symbol === tokenA.symbol || token.symbol === tokenB.symbol) {
                counter++
            }
        }
        return counter
    }
}