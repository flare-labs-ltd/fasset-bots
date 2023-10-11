import { ethers } from "ethers"
import { waitFinalize } from "../../utils"
import type { IBlazeSwapRouter, IERC20Metadata } from "../../../types"

// blazeswap add liquidity with wait finalize
export async function addLiquidity(
  blazeSwapRouter: IBlazeSwapRouter,
  tokenA: IERC20Metadata,
  tokenB: IERC20Metadata,
  amountA: bigint,
  amountB: bigint,
  liquidityProvider: ethers.Signer,
  provider: ethers.JsonRpcProvider
): Promise<void> {
  await waitFinalize(provider, liquidityProvider,
    tokenA.connect(liquidityProvider).approve(
      await blazeSwapRouter.getAddress(), amountA))
  await waitFinalize(provider, liquidityProvider,
    tokenB.connect(liquidityProvider).approve(
      await blazeSwapRouter.getAddress(), amountB))
  await waitFinalize(provider, liquidityProvider,
    blazeSwapRouter.connect(liquidityProvider).addLiquidity(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      amountA, amountB,
      0, 0, 0, 0,
      ethers.ZeroAddress,
      ethers.MaxUint256
    )
  )
}