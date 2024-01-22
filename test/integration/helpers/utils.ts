import { ethers } from "ethers"
import { priceBasedAddedDexReserves, swapToDexPrice, assetPriceForAgentCr } from "../../calculations"
import type { IUniswapV2Router, IERC20Metadata, IUniswapV2Pair } from "../../../types"
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
// F-Asset specific

// obtains the f-assets's price that results in agent having collateral ratio of crBips
export async function getCollateralPriceForAgentCr(
  contracts: Contracts,
  agentAddress: ethers.AddressLike,
  crBips: number,
  collateralKind: "vault" | "pool",
): Promise<bigint> {
  const agentInfo = await contracts.assetManager.getAgentInfo(agentAddress)
  const totalMintedUBA = agentInfo.mintedUBA + agentInfo.redeemingUBA + agentInfo.reservedUBA
  let collateralWei
  let collateralToken
  let tokenSymbol
  if (collateralKind === "vault") {
    collateralWei = agentInfo.totalVaultCollateralWei
    collateralToken = contracts.usdc
    tokenSymbol = "testUSDC"
  } else {
    collateralWei = agentInfo.totalPoolCollateralNATWei
    collateralToken = contracts.wNat
    tokenSymbol = "CFLR"
  }
  const { 0: collateralFtsoPrice, 2: collateralFtsoDecimals } = await contracts.priceReader.getPrice(tokenSymbol)
  const { 2: fAssetFtsoDecimals } = await contracts.priceReader.getPrice("testXRP")
  return assetPriceForAgentCr(
    BigInt(crBips),
    totalMintedUBA,
    collateralWei,
    collateralFtsoPrice,
    collateralFtsoDecimals,
    await collateralToken.decimals(),
    fAssetFtsoDecimals,
    await contracts.fAsset.decimals()
  )
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
  const [dex1FAsset, dex1Usdc] = await contracts.uniswapV2.getReserves(contracts.fAsset, contracts.usdc)
  const [dex2WNat, dex2Usdc] = await contracts.uniswapV2.getReserves(contracts.wNat, contracts.usdc)
  const dexPrice1 = BigInt(10_000) * dex1FAsset * BigInt(1e12) / dex1Usdc
  const dexPrice2 = BigInt(10_000) * dex2Usdc / dex2WNat
  return {
    'dex1': [dexPrice1, ftsoPrice1],
    'dex2': [dexPrice2, ftsoPrice2],
  }
}

/**
  * A high level function to set up the dex ecosystem
  * for both USDC/F-Asset and WNAT/USDC pairs.
  */
export async function syncDexReservesWithFtsoPrices(
  contracts: Contracts,
  signer: ethers.Wallet,
  provider: ethers.JsonRpcProvider,
  wrapNat = false
): Promise<void> {
  if (wrapNat) {
    // wrap user nat
    const leftoverNat = BigInt(100) * ethers.WeiPerEther
    const availableNat = await provider.getBalance(signer)
    if (availableNat > leftoverNat) {
      const wrapNat = availableNat - leftoverNat
      const ccall = contracts.wNat.connect(signer).deposit({ value: wrapNat })
      await waitFinalize(provider, signer, ccall)
    }
  }
  // we have only those F-Assets and CFLR available
  const availableFAsset = await contracts.fAsset.balanceOf(signer)
  const availableUsdc = await contracts.usdc.balanceOf(signer)
  const availableWNat = await contracts.wNat.balanceOf(signer)
  // get ftso prices of all relevant symbols
  const { 0: usdcPrice } = await contracts.priceReader.getPrice("testUSDC")
  const { 0: wNatPrice } = await contracts.priceReader.getPrice("CFLR")
  const { 0: assetPrice } = await contracts.priceReader.getPrice("testXRP")
  // align f-asset/usdc and wNat/usdc dex prices with the ftso with available balances
  // do this in two ways - with swap and with add liquidity
  try {
    await swapDexPairToPrice(
      contracts, contracts.fAsset, contracts.usdc,
      assetPrice, usdcPrice, availableFAsset, availableUsdc / BigInt(2),
      signer, provider
    )
  } catch {}
  try {
    await addLiquidityToDexPairPrice(
      contracts.uniswapV2, contracts.fAsset, contracts.usdc,
      assetPrice, usdcPrice, availableFAsset, availableUsdc / BigInt(2),
      signer, provider)
  } catch {}
  try {
    await swapDexPairToPrice(
      contracts, contracts.wNat, contracts.usdc,
      wNatPrice, usdcPrice, availableWNat, availableUsdc / BigInt(2),
      signer, provider
    )
  } catch {}
  try {
    await addLiquidityToDexPairPrice(
      contracts.uniswapV2, contracts.wNat, contracts.usdc,
      wNatPrice, usdcPrice, availableWNat, availableUsdc / BigInt(2),
      signer, provider)
  } catch {}
}

// (TODO: do not assume that ftso decimals are 5)
// set dex price of tokenA in tokenB by adding liquidity.
// both prices in the same currency, e.g. FLR/$, XRP/$
async function addLiquidityToDexPairPrice(
  uniswapV2: IUniswapV2Router,
  tokenA: IERC20Metadata,
  tokenB: IERC20Metadata,
  priceA: bigint,
  priceB: bigint,
  maxAddedA: bigint,
  maxAddedB: bigint,
  signer: ethers.Signer,
  provider: ethers.JsonRpcProvider
): Promise<void> {
  const decimalsA = await tokenA.decimals()
  const decimalsB = await tokenB.decimals()
  let reserveA = BigInt(0)
  let reserveB = BigInt(0)
  try {
    [reserveA, reserveB] = await uniswapV2.getReserves(tokenA, tokenB)
  } catch {
    // means there's no reserves for the dex pair
  }
  let [addedA, addedB] = priceBasedAddedDexReserves(
    reserveA, reserveB, priceA, priceB, decimalsA, decimalsB, maxAddedA, maxAddedB)
  if (addedA < 0) addedA = BigInt(0) // ideally we would need to remove liquidity
  if (addedB < 0) addedB = BigInt(0) // but user may not have any, so we leave it
  if (addedA == BigInt(0) && addedB == BigInt(0)) {
    console.error('add liquidity failure: no reserves can be added')
  } else {
    await addLiquidity(uniswapV2, tokenA, tokenB, addedA, addedB, signer, provider)
  }
}

// swap on dexes to achieve the given price
export async function swapDexPairToPrice(
  contracts: Contracts,
  tokenA: IERC20Metadata,
  tokenB: IERC20Metadata,
  priceA: bigint,
  priceB: bigint,
  maxSwapA: bigint,
  maxSwapB: bigint,
  signer: ethers.Signer,
  provider: ethers.JsonRpcProvider
): Promise<void> {
  // align dex prices with the ftso prices while not exceeding available balances
  const decimalsA = await tokenA.decimals()
  const decimalsB = await tokenB.decimals()
  const [reserveA, reserveB] = await contracts.uniswapV2.getReserves(tokenA, tokenB)
  let swapA = swapToDexPrice(reserveA, reserveB, priceA, priceB, decimalsA, decimalsB, maxSwapA)
  let swapB = swapToDexPrice(reserveB, reserveA, priceB, priceA, decimalsB, decimalsA, maxSwapB)
  if (swapA > 0) {
    await swap(contracts.uniswapV2, tokenA, tokenB, swapA, signer, provider)
  } else if (swapB > 0) {
    await swap(contracts.uniswapV2, tokenB, tokenA, swapB, signer, provider)
  }
}

/////////////////////////////////////////////////////////////////////////
// simpified (unsafe) blazeswap method calls

// blazeswap add liquidity with wait finalize
async function addLiquidity(
  uniswapV2: IUniswapV2Router,
  tokenA: IERC20Metadata,
  tokenB: IERC20Metadata,
  amountA: bigint,
  amountB: bigint,
  signer: ethers.Signer,
  provider: ethers.JsonRpcProvider
): Promise<void> {
  await waitFinalize(provider, signer, tokenA.connect(signer).approve(uniswapV2, amountA))
  await waitFinalize(provider, signer, tokenB.connect(signer).approve(uniswapV2, amountB))
  await waitFinalize(provider, signer, uniswapV2.connect(signer).addLiquidity(
    tokenA, tokenB,
    amountA, amountB,
    0, 0, 0, 0,
    signer,
    ethers.MaxUint256
  ))
}

// blazeswap remove liquidity with wait finalize
export async function removeLiquidity(
  uniswapV2: IUniswapV2Router,
  blazeSwapPair: IUniswapV2Pair,
  tokenA: IERC20Metadata,
  tokenB: IERC20Metadata,
  signer: ethers.Signer,
  provider: ethers.JsonRpcProvider
): Promise<void> {
  const dexTokens = await blazeSwapPair.balanceOf(signer)
  if (dexTokens > BigInt(0)) {
    await waitFinalize(provider, signer, blazeSwapPair.connect(signer).approve(uniswapV2, dexTokens))
    await waitFinalize(provider, signer, uniswapV2.connect(signer).removeLiquidity(
      tokenA, tokenB,
      dexTokens,
      0, 0,
      signer,
      ethers.MaxUint256
    ))
  } else {
    console.log('remove liquidity failure: no liquidity to remove')
  }
}

export async function swap(
  uniswapV2: IUniswapV2Router,
  tokenA: IERC20Metadata,
  tokenB: IERC20Metadata,
  amountA: bigint,
  signer: ethers.Signer,
  provider: ethers.JsonRpcProvider
): Promise<void> {
  await waitFinalize(provider, signer, tokenA.connect(signer).approve(uniswapV2, amountA))
  await waitFinalize(provider, signer, uniswapV2.connect(signer).swapExactTokensForTokens(
    amountA, 0,
    [tokenA, tokenB],
    signer,
    ethers.MaxUint256
  ))
}
