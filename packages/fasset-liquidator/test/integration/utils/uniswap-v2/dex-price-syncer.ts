import { WeiPerEther, Wallet, JsonRpcProvider, type Signer } from "ethers"
import { relativeTokenPrice, relativeTokenDexPrice } from "../../../calculations/calculations"
import { mulFactor } from "../../../utils/numeric"
import { logRemovedLiquidity } from "./log-format"
import { sleep, waitFinalize } from "../finalization"
import { getContracts } from '../contracts'
import { removeLiquidity, safelyGetReserves } from "./wrappers"
import { syncDexReservesWithFtsoPrices } from "./pool-sync"
import { FTSO_SYMBOLS } from "../../../config"
import type { IERC20, IERC20Metadata } from "../../../../types"
import type { Contracts } from "../interfaces/contracts"


type MaxRelativeSpendings = { [symbol: string]: number | undefined } | number
type MaxAbsoluteSpendings = { [symbol: string]: bigint }

const DEX_SYNC_SLEEP_MS = 60_000

export interface PoolConfig {
    symbolA: string
    symbolB: string
}

export type DexFtsoPriceSyncerConfig = {
    maxRelativeSpendings?: MaxRelativeSpendings
    maxAbsoluteSpendings?: MaxAbsoluteSpendings
    pools: PoolConfig[]
}

export class DexFtsoPriceSyncer {
    public readonly symbols: { [symbol: string]: string }
    public readonly symbolToToken: Map<string, IERC20Metadata>

    constructor(
        public network: "coston",
        public provider: JsonRpcProvider,
        public signer: Signer,
        public contracts: Contracts
    ) {
        this.symbols = FTSO_SYMBOLS[network]
        this.symbolToToken = DexFtsoPriceSyncer.supportedTokens(this.symbols, contracts)
    }

    public static async create(network: "coston", rpcUrl: string, assetManager: string, signerPrivateKey: string): Promise<DexFtsoPriceSyncer> {
        const provider = new JsonRpcProvider(rpcUrl)
        const signer = new Wallet(signerPrivateKey, provider)
        const contracts = await getContracts(assetManager, network, provider)
        return new DexFtsoPriceSyncer(network, provider, signer, contracts)
    }

    // adjust for new / different tokens (according to network)
    public static supportedTokens(symbols: { [symbol: string]: string }, contracts: Contracts): Map<string, IERC20Metadata> {
        return new Map([
            [symbols.USDC, contracts.collaterals.USDC],
            [symbols.USDT, contracts.collaterals.USDT],
            [symbols.WETH, contracts.collaterals.WETH],
            [symbols.TEST_XRP, contracts.fAsset],
            [symbols.WNAT, contracts.wNat]
        ])
    }

    public async run(config: DexFtsoPriceSyncerConfig, greedySpend: boolean): Promise<void> {
        while (true) {
            try {
                await this.syncDex(config, greedySpend)
            } catch (error) {
                console.error("Error runninx DexFtsoPriceSyncer bot", error)
            }
            await sleep(DEX_SYNC_SLEEP_MS)
        }
    }

    public async syncDex(config: DexFtsoPriceSyncerConfig, greedySpend: boolean): Promise<void> {
        if (config.maxAbsoluteSpendings === undefined) {
            config.maxAbsoluteSpendings = await this.distributeSpendings(config, greedySpend)
        }
        for (const pool of config.pools) {
            const tokenA = this.symbolToToken.get(pool.symbolA)!
            const tokenB = this.symbolToToken.get(pool.symbolB)!
            // sync pool with the ftso price
            try {
                await syncDexReservesWithFtsoPrices(
                    this.contracts.uniswapV2, this.contracts.priceReader,
                    tokenA, tokenB, pool.symbolA, pool.symbolB,
                    config.maxAbsoluteSpendings[pool.symbolA],
                    config.maxAbsoluteSpendings[pool.symbolB],
                    this.signer, this.provider, true
                )
            } catch (error: any) {
                console.error(`Error syncing pool (${pool.symbolA}, ${pool.symbolB})`, error.toString())
            }
        }
    }

    public async removeAllLiquidity(config: PoolConfig[]): Promise<void> {
        for (const { symbolA, symbolB } of config) {
            console.log(`removing liquidity from (${symbolA}, ${symbolB}) pool`)
            const tokenA = this.symbolToToken.get(symbolA)!
            const tokenB = this.symbolToToken.get(symbolB)!
            const [removedA, removedB] = await removeLiquidity(this.contracts.uniswapV2, tokenA, tokenB, this.signer, this.provider)
            logRemovedLiquidity(removedA, removedB, symbolA, symbolB, await tokenA.decimals(), await tokenB.decimals())
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

    public async getReserves(tokenA: IERC20, tokenB: IERC20): Promise<[bigint, bigint]> {
        return safelyGetReserves(this.contracts.uniswapV2, tokenA, tokenB)
    }

    public async getFtsoPriceForPair(symbolA: string, symbolB: string): Promise<bigint> {
        const { _price: priceA } = await this.contracts.priceReader.getPrice(symbolA)
        const { _price: priceB } = await this.contracts.priceReader.getPrice(symbolB)
        return relativeTokenPrice(priceA, priceB)
    }

    public async getDexPriceForPair(tokenA: IERC20Metadata, tokenB: IERC20Metadata): Promise<bigint> {
        const decimalsA = await tokenA.decimals()
        const decimalsB = await tokenB.decimals()
        const [reserveA, reserveB] = await safelyGetReserves(this.contracts.uniswapV2, tokenA, tokenB)
        return relativeTokenDexPrice(reserveA, reserveB, decimalsA, decimalsB)
    }

    // determine amounts of max tokens to be spent for each token from user's specified balance percentages
    // greedy determines whether to spend all tokens on a single pair or distribute them across all pairs
    private async distributeSpendings(config: DexFtsoPriceSyncerConfig, greedy: boolean): Promise<MaxAbsoluteSpendings> {
        const maxSpent: MaxAbsoluteSpendings = {}
        for (const pairs of config.pools) {
            for (const symbol of [pairs.symbolA, pairs.symbolB]) {
                const token = this.symbolToToken.get(symbol)!
                if (maxSpent[symbol] === undefined) {
                    let maxSpentToken = await token.balanceOf(this.signer)
                    const factor = (typeof config.maxRelativeSpendings === "number")
                        ? config.maxRelativeSpendings
                        : config.maxRelativeSpendings?.[symbol]
                    if (factor !== undefined) {
                        maxSpentToken = mulFactor(maxSpentToken, factor)
                    }
                    if (!greedy) {
                        maxSpentToken /= BigInt(this.numberOfPairsWithToken(symbol, config.pools))
                    }
                    maxSpent[symbol] = maxSpentToken
                }
            }
        }
        return maxSpent
    }

    private numberOfPairsWithToken(symbol: string, pools: PoolConfig[]): number {
        let counter = 0
        for (const { symbolA, symbolB } of pools) {
            if (symbol === symbolA || symbol === symbolB) counter++
        }
        return counter
    }
}
