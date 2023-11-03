import { BaseContract, ethers } from "ethers"
import { cappedPriceBasedDexReserves } from "../../calculations"
import type { IBlazeSwapRouter, IERC20Metadata } from "../../../types"
import type { Contracts } from "./interface"

/////////////////////////////////////////////////////////////////////////
// general functions

async function sleep(milliseconds: number) {
  await new Promise((resolve: any) => {
    setTimeout(() => {
      resolve()
    }, milliseconds)
  })
}

/////////////////////////////////////////////////////////////////////////
// ethers specific

export async function waitFinalize(
  provider: ethers.JsonRpcProvider,
  signer: ethers.Signer,
  prms: Promise<ethers.ContractTransactionResponse>
): Promise<ethers.ContractTransactionReceipt> {
  const signerAddress = await signer.getAddress()
  const nonce = await provider.getTransactionCount(signer)
  let response
  try {
    response = ((await prms).wait())
  } catch {
    response = await prms
    await sleep(5_000)
  }
  while ((await provider.getTransactionCount(signerAddress)) === nonce) {
    await sleep(100)
  }
  return response as any
}

/////////////////////////////////////////////////////////////////////////
// ecosystem setup and manipulation

export async function initFtsoSyncedDexReserves(
  contracts: Contracts,
  liquidityProvider: ethers.Wallet,
  provider: ethers.JsonRpcProvider
): Promise<void> {
  // we have only those F-Assets and CFLR available
  const availableFAsset = await contracts.fAsset.balanceOf(liquidityProvider)
  const availableUsdc = await contracts.usdc.balanceOf(liquidityProvider)
  const availableWNat = await contracts.wNat.balanceOf(liquidityProvider)
  // get ftso prices of all relevant symbols
  const { 0: usdcPrice } = await contracts.priceReader.getPrice("testUSDC")
  const { 0: wNatPrice } = await contracts.priceReader.getPrice("CFLR")
  const { 0: assetPrice } = await contracts.priceReader.getPrice("testXRP")
  // align dex prices with the ftso prices while not exceeding available balances
  // (TODO: do not assume that ftso decimals are 5 or that dex reserves are empty)
  await setDexPairPrice(
    contracts.blazeSwapRouter, contracts.fAsset, contracts.usdc,
    assetPrice, usdcPrice, availableFAsset, availableUsdc / BigInt(2),
    liquidityProvider, provider)
  await setDexPairPrice(
    contracts.blazeSwapRouter, contracts.wNat, contracts.usdc,
    wNatPrice, usdcPrice, availableWNat, availableUsdc / BigInt(2),
    liquidityProvider, provider)
}

// set initial dex price of tokenA in tokenB
// both prices in the same currency,
// e.g. FLR/$, XRP/$
async function setDexPairPrice(
  blazeSwapRouter: IBlazeSwapRouter,
  tokenA: IERC20Metadata,
  tokenB: IERC20Metadata,
  priceA: bigint,
  priceB: bigint,
  reserveA: bigint,
  maxReserveB: bigint,
  liquidityProvider: ethers.Signer,
  provider: ethers.JsonRpcProvider
): Promise<void> {
  const decimalsA = await tokenA.decimals()
  const decimalsB = await tokenB.decimals()
  let reserveB
  [reserveA, reserveB] = cappedPriceBasedDexReserves(priceA, priceB, decimalsA, decimalsB, reserveA, maxReserveB)
  await addLiquidity(blazeSwapRouter, tokenA, tokenB, reserveA, reserveB, liquidityProvider, provider)
}

// blazeswap add liquidity with wait finalize
async function addLiquidity(
  blazeSwapRouter: IBlazeSwapRouter,
  tokenA: IERC20Metadata,
  tokenB: IERC20Metadata,
  amountA: bigint,
  amountB: bigint,
  liquidityProvider: ethers.Signer,
  provider: ethers.JsonRpcProvider
): Promise<void> {
  await waitFinalize(provider, liquidityProvider, tokenA.connect(liquidityProvider).approve(blazeSwapRouter, amountA))
  await waitFinalize(provider, liquidityProvider, tokenB.connect(liquidityProvider).approve(blazeSwapRouter, amountB))
  await waitFinalize(provider, liquidityProvider, blazeSwapRouter.connect(liquidityProvider).addLiquidity(
    tokenA,
    tokenB,
    amountA, amountB,
    0, 0, 0, 0,
    ethers.ZeroAddress,
    ethers.MaxUint256
  ))
}
