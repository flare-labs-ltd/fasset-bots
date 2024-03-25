import { Contract, MaxUint256 } from "ethers"
import { waitFinalize } from "../finalization"
import { abi as uniswapV2PairAbi } from '../../../../artifacts/contracts/interfaces/IUniswapV2/IUniswapV2Pair.sol/IUniswapV2Pair.json'
import type { Signer, JsonRpcProvider, AddressLike } from "ethers"
import type { IERC20, IERC20Metadata, IUniswapV2Router, IUniswapV2Pair } from "../../../../types"


export async function safelyGetReserves(
    uniswapV2: IUniswapV2Router,
    tokenA: IERC20,
    tokenB: IERC20
): Promise<[bigint, bigint]> {
    let reserveA = BigInt(0)
    let reserveB = BigInt(0)
    // eslint-disable-next-line no-empty
    try { ({ 0: reserveA, 1: reserveB } = await uniswapV2.getReserves(tokenA, tokenB)) } catch (e) { }
    return [reserveA, reserveB]
}

export async function getPairFor(
    uniswapV2: IUniswapV2Router,
    tokenA: AddressLike,
    tokenB: AddressLike,
    provider: JsonRpcProvider
): Promise<IUniswapV2Pair> {
    const address = await uniswapV2.pairFor(tokenA, tokenB)
    return new Contract(address, uniswapV2PairAbi, provider) as any
}

// uniswapV2 add liquidity with wait finalize
export async function addLiquidity(
    uniswapV2: IUniswapV2Router,
    tokenA: IERC20Metadata,
    tokenB: IERC20Metadata,
    amountA: bigint,
    amountB: bigint,
    signer: Signer,
    provider: JsonRpcProvider
): Promise<void> {
    await waitFinalize(provider, signer, tokenA.connect(signer).approve(uniswapV2, amountA))
    await waitFinalize(provider, signer, tokenB.connect(signer).approve(uniswapV2, amountB))
    await waitFinalize(provider, signer, uniswapV2.connect(signer).addLiquidity(
        tokenA, tokenB,
        amountA, amountB,
        0, 0, 0, 0,
        signer,
        MaxUint256
    ))
}

export async function removeLiquidity(
    uniswapV2: IUniswapV2Router,
    tokenA: IERC20Metadata,
    tokenB: IERC20Metadata,
    signer: Signer,
    provider: JsonRpcProvider
): Promise<[bigint, bigint]> {
    const pair = await getPairFor(uniswapV2, tokenA, tokenB, provider)
    const dexTokens = await pair.balanceOf(signer)
    if (dexTokens > BigInt(0)) {
        const oldBalanceA = await tokenA.balanceOf(signer.getAddress())
        const oldBalanceB = await tokenB.balanceOf(signer.getAddress())
        await waitFinalize(provider, signer, pair.connect(signer).approve(uniswapV2, dexTokens))
        await waitFinalize(provider, signer, uniswapV2.connect(signer).removeLiquidity(
            tokenA, tokenB,
            dexTokens,
            0, 0,
            signer,
            MaxUint256
        ))
        const newBalanceA = await tokenA.balanceOf(signer.getAddress())
        const newBalanceB = await tokenB.balanceOf(signer.getAddress())
        return [newBalanceA - oldBalanceA, newBalanceB - oldBalanceB]
    } else {
        const symbolA = await tokenA.symbol()
        const symbolB = await tokenB.symbol()
        console.log(`No liquidity to remove from (${symbolA}, ${symbolB}) pool`)
        return [BigInt(0), BigInt(0)]
    }
}

export async function swap(
    uniswapV2: IUniswapV2Router,
    tokenA: IERC20Metadata,
    tokenB: IERC20Metadata,
    amountA: bigint,
    signer: Signer,
    provider: JsonRpcProvider
): Promise<void> {
    await waitFinalize(provider, signer, tokenA.connect(signer).approve(uniswapV2, amountA))
    await waitFinalize(provider, signer, uniswapV2.connect(signer).swapExactTokensForTokens(
        amountA, 0,
        [tokenA, tokenB],
        signer,
        MaxUint256
    ))
}
