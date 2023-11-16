import { ethers } from "ethers"
import { priceBasedAddedDexReserves } from "../../calculations"
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

export async function dexVsFtsoPrices(contracts: Contracts): Promise<{
  'dex1': [bigint, bigint],
  'dex2': [bigint, bigint],
}> {
  // get ftso prices of all relevant symbols
  const { 0: usdcPrice } = await contracts.priceReader.getPrice("testUSDC")
  const { 0: wNatPrice } = await contracts.priceReader.getPrice("CFLR")
  const { 0: assetPrice } = await contracts.priceReader.getPrice("testXRP")
  const ftsoPrice1 = BigInt(10_000) * usdcPrice / assetPrice
  const ftsoPrice2 = BigInt(10_000) * wNatPrice / usdcPrice
  // get dex reserves
  const [dex1FAsset, dex1Usdc] = await contracts.blazeSwapRouter.getReserves(contracts.fAsset, contracts.usdc)
  const [dex2WNat, dex2Usdc] = await contracts.blazeSwapRouter.getReserves(contracts.wNat, contracts.usdc)
  const dexPrice1 = BigInt(10_000) * dex1FAsset * BigInt(1e12) / dex1Usdc
  const dexPrice2 = BigInt(10_000) * dex2Usdc / dex2WNat
  return {
    'dex1': [dexPrice1, ftsoPrice1],
    'dex2': [dexPrice2, ftsoPrice2],
  }
}

export async function syncDexReservesWithFtsoPrices(
  contracts: Contracts,
  liquidityProvider: ethers.Wallet,
  provider: ethers.JsonRpcProvider,
  wrapNat = false
): Promise<void> {
  if (wrapNat) {
    // wrap user nat
    const leftoverNat = BigInt(100) * ethers.WeiPerEther
    const availableNat = await provider.getBalance(liquidityProvider)
    if (availableNat > leftoverNat) {
      const wrapNat = availableNat - leftoverNat
      const ccall = contracts.wNat.connect(liquidityProvider).deposit({ value: wrapNat })
      await waitFinalize(provider, liquidityProvider, ccall)
    }
  }
  // we have only those F-Assets and CFLR available
  const availableFAsset = await contracts.fAsset.balanceOf(liquidityProvider)
  const availableUsdc = await contracts.usdc.balanceOf(liquidityProvider)
  const availableWNat = await contracts.wNat.balanceOf(liquidityProvider)
  // get ftso prices of all relevant symbols
  const { 0: usdcPrice } = await contracts.priceReader.getPrice("testUSDC")
  const { 0: wNatPrice } = await contracts.priceReader.getPrice("CFLR")
  const { 0: assetPrice } = await contracts.priceReader.getPrice("testXRP")
  // align dex prices with the ftso prices while not exceeding available balances
  // (TODO: do not assume that ftso decimals are 5)
  await setDexPairPrice(
    contracts.blazeSwapRouter, contracts.fAsset, contracts.usdc,
    assetPrice, usdcPrice, availableFAsset, availableUsdc / BigInt(2),
    liquidityProvider, provider)
  await setDexPairPrice(
    contracts.blazeSwapRouter, contracts.wNat, contracts.usdc,
    wNatPrice, usdcPrice, availableWNat, availableUsdc / BigInt(2),
    liquidityProvider, provider)
}

// set dex price of tokenA in tokenB by adding liquidity.
// both prices in the same currency, e.g. FLR/$, XRP/$
async function setDexPairPrice(
  blazeSwapRouter: IBlazeSwapRouter,
  tokenA: IERC20Metadata,
  tokenB: IERC20Metadata,
  priceA: bigint,
  priceB: bigint,
  maxAddedA: bigint,
  maxAddedB: bigint,
  liquidityProvider: ethers.Signer,
  provider: ethers.JsonRpcProvider
): Promise<void> {
  const decimalsA = await tokenA.decimals()
  const decimalsB = await tokenB.decimals()
  let reserveA = BigInt(0)
  let reserveB = BigInt(0)
  try {
    [reserveA, reserveB] = await blazeSwapRouter.getReserves(tokenA, tokenB)
  } catch {
    // means there's no reserves for the dex pair
  }
  const [addedA, addedB] = priceBasedAddedDexReserves(
    reserveA, reserveB, priceA, priceB, decimalsA, decimalsB, maxAddedA, maxAddedB)
  if (addedA < 0 || addedB < 0 || (addedA == BigInt(0) && addedB == BigInt(0))) {
    console.error('negative added reserves')
  } else {
    await addLiquidity(blazeSwapRouter, tokenA, tokenB, addedA, addedB, liquidityProvider, provider)
  }
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
    liquidityProvider,
    ethers.MaxUint256
  ))
}
