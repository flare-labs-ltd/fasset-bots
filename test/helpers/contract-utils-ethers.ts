import { ethers } from "ethers"
import { IBlazeSwapRouter, IERC20Metadata } from "../../typechain-ethers"
import { sleep } from "./utils"

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

export async function addLiquidity(
  blazeSwapRouter: IBlazeSwapRouter,
  tokenA: IERC20Metadata,
  tokenB: IERC20Metadata,
  amountA: bigint,
  amountB: bigint,
  liquidityProvider: ethers.Wallet,
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
  assetFtsoDecimals: bigint,
  assetTokenDecimals: bigint
): bigint {
  // calculate necessary price of asset, expressed in collateral wei
  // P(Vw, Fu) = v / (f Cr)
  // P(Vw, Fu) = P(Vw, S) * P(S, Fu)
  const assetUBAPriceCollateralWei = collateralWei
    * BigInt(10_000)
    / totalMintedUBA
    / crBips
  // calculate new ftso price for the asset
  // P(SF, F) = 10^((dF + fV) - (dV + fF)) P(SV, V) P(Vw, Fu)
  const expPlus = collateralFtsoDecimals + assetTokenDecimals
  const expMinus = assetFtsoDecimals + collateralTokenDecimals
  const assetFtsoPrice = collateralFtsoPrice
    * assetUBAPriceCollateralWei
    * BigInt(10) ** expPlus
    / BigInt(10) ** expMinus
  return assetFtsoPrice
}