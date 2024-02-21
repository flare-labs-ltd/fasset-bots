import { ethers } from 'hardhat'
import * as calc from '../../calculations'
import type { Signer } from 'ethers'
import type { ERC20, ERC20Mock, IUniswapV2Router } from '../../../types'


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
    pair: ERC20,
    tokenA: ERC20Mock,
    tokenB: ERC20Mock,
    amountA: bigint,
    signer: Signer
): Promise<void> {
    const totalLiquidity = await pair.totalSupply()
    const pairTokenABalance = await tokenA.balanceOf(pair)
    const liquidity = totalLiquidity * amountA / pairTokenABalance
    await router.removeLiquidity(
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
    tokenPath: ERC20Mock[],
    amountA: bigint,
    swapper: Signer,
    amountOutMin: bigint = BigInt(0)
): Promise<void> {
    await tokenPath[0].connect(swapper).approve(router, amountA)
    await router.connect(swapper).swapExactTokensForTokens(
        amountA, amountOutMin, tokenPath, swapper, ethers.MaxUint256)
}

// needed if a swap affects the reserves of a pair used in a subsequent swap
export async function swapOutputs(
    router: IUniswapV2Router,
    paths: ERC20[][],
    amountsA: bigint[]
): Promise<bigint[]> {
    // store reserves
    const reserves = []
    for (let i = 0; i < paths.length; i++) {
        const reserve = []
        for (let j = 1; j < paths[i].length; j++) {
            reserve.push(await router.getReserves(
                paths[i][j - 1],
                paths[i][j]
            ))
        }
        reserves.push(reserve)
    }
    const namePaths = await Promise.all(paths.map(async path =>
        await Promise.all(path.map(async token => token.name()))
    ))
    return calc.consecutiveSwapOutputs(amountsA, namePaths, reserves)
}

export async function swapAndAddLiquidityToGetReserves(
    router: IUniswapV2Router,
    tokenA: ERC20Mock,
    tokenB: ERC20Mock,
    newReservesA: bigint,
    newReservesB: bigint,
    signer: Signer
): Promise<void> {
    const [oldReservesA, oldReservesB] = await router.getReserves(tokenA, tokenB)
    const [swapA, swapB, addLiquidityA, addLiquidityB] = calc.swapAndAddLiquidityToGetReserves(
        oldReservesA, oldReservesB, newReservesA, newReservesB)
    if (swapA > 0) {
        await tokenA.mint(signer, swapA)
        await swap(router, [tokenA, tokenB], swapA, signer)
    } else if (swapB > 0) {
        await tokenB.mint(signer, swapB)
        await swap(router, [tokenB, tokenA], swapB, signer)
    }
    if (addLiquidityA > 0 && addLiquidityB > 0) {
        await addLiquidity(router, tokenA, tokenB, addLiquidityA, addLiquidityB, signer)
    } else if (addLiquidityA < 0 && addLiquidityB < 0) {
        await removeLiquidity(router, tokenA, tokenA, tokenB, -addLiquidityA, signer)
    }
}