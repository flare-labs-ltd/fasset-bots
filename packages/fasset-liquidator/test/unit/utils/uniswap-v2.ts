import { ethers } from 'hardhat'
import * as calc from '../../calculations/calculations'
import type { Signer } from 'ethers'
import type { ERC20, ERC20Mock, IUniswapV2Pair, IUniswapV2Router } from '../../../types'


//////////////////////////////////////////////////////////////////////
// basic unsafe wrappers

export async function addLiquidity(
    router: IUniswapV2Router,
    tokenA: ERC20Mock,
    tokenB: ERC20Mock,
    amountA: bigint,
    amountB: bigint,
    provider: Signer,
    mint: boolean = true
): Promise<void> {
    if (mint) {
        await tokenA.mint(provider, amountA)
        await tokenB.mint(provider, amountB)
    }
    await tokenA.connect(provider).approve(router, amountA)
    await tokenB.connect(provider).approve(router, amountB)
    await router.connect(provider).addLiquidity(
        tokenA, tokenB,
        amountA, amountB,
        0, 0, 0, 0,
        provider,
        ethers.MaxUint256
    )
}

export async function removeLiquidity(
    router: IUniswapV2Router,
    tokenA: ERC20Mock,
    tokenB: ERC20Mock,
    liquidity: bigint,
    signer: Signer
): Promise<void> {
    await router.connect(signer).removeLiquidity(
        tokenA, tokenB, liquidity,
        0, 0,
        signer, ethers.MaxUint256
    )
}

// calculates the amount received when swapping amountA through path
export async function swapOutput(
    router: IUniswapV2Router,
    path: ERC20[],
    amountA: bigint
): Promise<bigint> {
    let amountB = amountA
    for (let i = 1; i < path.length; i++) {
        const [reserveA, reserveB] = await router.getReserves(path[i - 1], path[i])
        amountB = calc.swapOutput(amountB, reserveA, reserveB)
    }
    return amountB
}

// calculates the amount of input needed to swap to amountB through path
export async function swapInput(
    router: IUniswapV2Router,
    path: ERC20[],
    amountB: bigint
): Promise<bigint> {
    let amountA = amountB
    for (let i = path.length - 1; i > 0; i--) {
        const [reserveA, reserveB] = await router.getReserves(path[i - 1], path[i])
        amountA = calc.swapInput(amountA, reserveA, reserveB)
    }
    return amountA
}

export async function swap(
    router: IUniswapV2Router,
    amountA: bigint,
    tokenPath: ERC20Mock[],
    swapper: Signer,
    amountOutMin: bigint = BigInt(0)
): Promise<void> {
    await tokenPath[0].connect(swapper).approve(router, amountA)
    await router.connect(swapper).swapExactTokensForTokens(
        amountA, amountOutMin, tokenPath, swapper, ethers.MaxUint256)
}

// needed if a swap affects the reserves of a pair used in a subsequent swap
export async function consecutiveSwapOutputs(
    router: IUniswapV2Router,
    amountsA: bigint[],
    paths: ERC20[][]
): Promise<bigint[]> {
    // store reserves
    const reserves = []
    for (let i = 0; i < paths.length; i++) {
        const reserve = []
        for (let j = 1; j < paths[i].length; j++) {
            const [reserveA, reserveB] = await router.getReserves(
                paths[i][j - 1], paths[i][j]
            )
            reserve.push([reserveA, reserveB] as [bigint, bigint])
        }
        reserves.push(reserve)
    }
    const namePaths = await Promise.all(paths.map(async path =>
        await Promise.all(path.map(async token => token.name()))
    ))
    return calc.consecutiveSwapOutputs(amountsA, namePaths, reserves)
}

//////////////////////////////////////////////////////////////////////
// specific methods

export async function changeLiquidity(
    router: IUniswapV2Router,
    pair: IUniswapV2Pair,
    tokenA: ERC20Mock,
    tokenB: ERC20Mock,
    amountA: bigint,
    amountB: bigint,
    signer: Signer
): Promise<void> {
    if (amountA > 0 && amountB > 0) {
        await addLiquidity(router, tokenA, tokenB, amountA, amountB, signer)
    } else if (amountA < 0 && amountB < 0) {
        const liquiditySupply = await pair.totalSupply()
        const pairBalanceA = await tokenA.balanceOf(pair)
        const liquidity = liquiditySupply * (-amountA) / pairBalanceA
        await pair.connect(signer).approve(router, liquidity)
        await removeLiquidity(router, tokenA, tokenB, liquidity, signer)
    } else {
        throw new Error("changeLiquidity: invalid amounts")
    }
}

export async function multiswap(
    router: IUniswapV2Router,
    tokenA: ERC20Mock,
    tokenB: ERC20Mock,
    swapA: bigint,
    swapB: bigint,
    signer: Signer
): Promise<void> {
    if (swapA > 0) {
        await tokenA.mint(signer, swapA)
        await swap(router, swapA, [tokenA, tokenB], signer)
    } else if (swapB > 0) {
        await tokenB.mint(signer, swapB)
        await swap(router, swapB, [tokenB, tokenA], signer)
    }
}

// swap on dexes to achieve the given price
export async function swapToPrice(
    router: IUniswapV2Router,
    tokenA: ERC20Mock,
    tokenB: ERC20Mock,
    priceA: bigint,
    priceB: bigint,
    decimalsA: bigint,
    decimalsB: bigint,
    signer: Signer
): Promise<void> {
    const [reserveA, reserveB] = await router.getReserves(tokenA, tokenB)
    const swapA = calc.swapToDexPrice(reserveA, reserveB, priceA, priceB, decimalsA, decimalsB)
    const swapB = calc.swapToDexPrice(reserveB, reserveA, priceB, priceA, decimalsB, decimalsA)
    await multiswap(router, tokenA, tokenB, swapA, swapB, signer)
}

export async function swapToRatio(
    router: IUniswapV2Router,
    tokenA: ERC20Mock,
    tokenB: ERC20Mock,
    ratioA: bigint,
    ratioB: bigint,
    signer: Signer
): Promise<void> {
    const [reserveA, reserveB] = await router.getReserves(tokenA, tokenB)
    const swapA = calc.swapToDexRatio(reserveA, reserveB, ratioA, ratioB)
    const swapB = calc.swapToDexRatio(reserveB, reserveA, ratioB, ratioA)
    await multiswap(router, tokenA, tokenB, swapA, swapB, signer)
}

export async function swapAndChangeLiquidityToGetReserves(
    router: IUniswapV2Router,
    pair: IUniswapV2Pair,
    tokenA: ERC20Mock,
    tokenB: ERC20Mock,
    newReservesA: bigint,
    newReservesB: bigint,
    signer: Signer
): Promise<void> {
    const [oldReservesA, oldReservesB] = await router.getReserves(tokenA, tokenB)
    const [swapA, swapB, addLiquidityA, addLiquidityB] = calc.swapAndChangeLiquidityToGetReserves(
        oldReservesA, oldReservesB, newReservesA, newReservesB)
    await multiswap(router, tokenA, tokenB, swapA, swapB, signer)
    await changeLiquidity(router, pair, tokenA, tokenB, addLiquidityA, addLiquidityB, signer)
}