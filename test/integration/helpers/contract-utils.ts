import { ethers } from "ethers"
import { IBlazeSwapRouter, IERC20Metadata } from "../../../typechain-ethers"
import { sleep } from "../../helpers/utils"


////////////////////////////////////////////////////////////////////////////
// general ethers-specific

export async function waitFinalize(
  provider: ethers.JsonRpcProvider,
  signer: ethers.Signer,
  prms: Promise<ethers.ContractTransactionResponse>
): Promise<ethers.ContractTransactionReceipt> {
  const signerAddress = await signer.getAddress()
  const nonce = await provider.getTransactionCount(signer)
  const res = await (await prms).wait()
  while ((await provider.getTransactionCount(signerAddress)) == nonce) {
    await sleep(100)
  }
  return res!
}

////////////////////////////////////////////////////////////////////////////
// blazeswap liquidity

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

////////////////////////////////////////////////////////////////////////////
// price/reserves calculations

// prices are in same custom currency
export function collateralForCr(
  crBips: bigint,
  totalMintedUBA: bigint,
  priceFAsset: bigint,
  priceCollateral: bigint,
  decimalsFAsset: bigint,
  decimalsCollateral: bigint
): bigint {
  return totalMintedUBA
    * priceFAsset
    * BigInt(10) ** decimalsCollateral
    * crBips
    / priceCollateral
    / BigInt(10) ** decimalsFAsset
    / BigInt(10_000)
}

// get tokenA/tokenB reserve, based on
// the prices that they should have and
// tokenB/tokenA reserve
// prices should be in the same currency,
// e.g. FLR/$, XRP/$
export function priceBasedDexReserve(
  priceA: bigint,
  priceB: bigint,
  decimalsA: bigint,
  decimalsB: bigint,
  reserveA: bigint,
): bigint {
  // reserveB / reserveA = priceA / priceB
  return reserveA
    * priceA
    * BigInt(10) ** decimalsB
    / BigInt(10) ** decimalsA
    / priceB
}

// get the asset price that results in given
// given collateral ratio for the agent
export function assetPriceForAgentCr(
  crBips: bigint,
  totalMintedUBA: bigint,
  collateralWei: bigint,
  collateralFtsoPrice: bigint,
  collateralFtsoDecimals: bigint,
  collateralTokenDecimals: bigint,
  fAssetFtsoDecimals: bigint,
  fAssetTokenDecimals: bigint
): bigint {
  // price of f-asset UBA in collateral Wei
  // v / (P(Fu, Vw) f) = R
  // P(Fu, Vw) = v / (f R)
  // new ftso price for the asset
  // P(Fu, Vw) = 10^((dV + fV) - (dF + fF)) P(F, SF) / P(V, SV)
  // P(F, SF) = 10^((dF + fF) - (dV + fV)) P(V, SV) P(Fu, Vw)
  // put together
  // P(F, SF) = 10^((dF + fF) - (dV + fV)) P(V, SV) v / (f R)
  const expPlus = fAssetTokenDecimals + fAssetFtsoDecimals
  const expMinus = collateralTokenDecimals + collateralFtsoDecimals
  return BigInt(10) ** expPlus
    * collateralFtsoPrice
    * collateralWei
    * BigInt(10_000)
    / BigInt(10) ** expMinus
    / crBips
    / totalMintedUBA
}