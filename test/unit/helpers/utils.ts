
import { ethers } from 'hardhat'
import { expect } from 'chai'
import * as crypto from 'crypto'
import * as calc from '../../calculations'
import type { Signer } from 'ethers'
import type { ERC20, BlazeSwapRouter, ERC20Mock, FakePriceReader } from '../../../types'
import type { UnderlyingAsset, EcosystemConfig, AssetConfig, TestContext } from '../fixtures/interface'


////////////////////////////////////////////////////////////////////////////
// test helpers

// prices expressed in e.g. usd
export async function setFtsoPrices(
  assetConfig: AssetConfig,
  priceReader: FakePriceReader,
  priceAsset: bigint,
  priceVault: bigint,
  pricePool: bigint
): Promise<void> {
  await priceReader.setPrice(assetConfig.asset.ftsoSymbol, priceAsset)
  await priceReader.setPrice(assetConfig.vault.ftsoSymbol, priceVault)
  await priceReader.setPrice(assetConfig.pool.ftsoSymbol, pricePool)
}

export async function setupEcosystem(
  assetConfig: AssetConfig,
  config: EcosystemConfig,
  context: TestContext
): Promise<void> {
  const { assetManager, blazeSwapRouter, fAsset, vault, pool, agent, priceReader } = context.contracts
  // set ftso prices and dex reserves (pool-fAsset is needed only for testing swaps through non-arbitrary paths)
  await assetManager.setLiquidationFactors(config.liquidationFactorBips, config.liquidationFactorVaultBips)
  await setFtsoPrices(assetConfig, priceReader, config.assetFtsoPrice, config.vaultFtsoPrice, config.poolFtsoPrice)
  await addLiquidity(blazeSwapRouter, vault, fAsset, config.dex1VaultReserve, config.dex1FAssetReserve, context.signers.deployer)
  await addLiquidity(blazeSwapRouter, pool, vault, config.dex2PoolReserve, config.dex2VaultReserve, context.signers.deployer)
  await addLiquidity(blazeSwapRouter, pool, fAsset, config.dex3PoolReserve, config.dex3FAssetReserve, context.signers.deployer)
  // deposit collaterals and mint
  await agent.depositVaultCollateral(config.vaultCollateral)
  await agent.depositPoolCollateral(config.poolCollateral)
  await agent.mint(context.signers.fAssetMinter, config.mintedUBA)
  // put agent in full liquidation if configured so (this implies agent did an illegal operation)
  if (config.fullLiquidation) await assetManager.putAgentInFullLiquidation(agent)
  const { status, vaultCollateralRatioBIPS, poolCollateralRatioBIPS } = await assetManager.getAgentInfo(agent)
  expect(status).to.equal(config.fullLiquidation ? 3 : 0)
  // check that agent cr is as expected
  expect(vaultCollateralRatioBIPS).to.be.closeTo(config.expectedVaultCrBips, 1)
  expect(poolCollateralRatioBIPS).to.be.closeTo(config.expectedPoolCrBips, 1)
}

////////////////////////////////////////////////////////////////////////////
// dex helpers

export async function addLiquidity(
  router: BlazeSwapRouter,
  tokenA: ERC20Mock,
  tokenB: ERC20Mock,
  amountA: bigint,
  amountB: bigint,
  liquidityProvider: Signer
): Promise<void> {
  // mint because we just want to add liquidity to the pool,
  // are not testing for the effects on liquidity providers
  await tokenA.mint(liquidityProvider, amountA)
  await tokenB.mint(liquidityProvider, amountB)
  await tokenA.connect(liquidityProvider).approve(router, amountA)
  await tokenB.connect(liquidityProvider).approve(router, amountB)
  await router.connect(liquidityProvider).addLiquidity(
    tokenA, tokenB,
    amountA, amountB,
    0, 0, 0, 0,
    liquidityProvider,
    ethers.MaxUint256
  )
}

// calculates the amount received when swapping amountA through path
export async function swapOutput(
  router: BlazeSwapRouter,
  path: ERC20[],
  amountA: bigint
): Promise<bigint> {
  let amountB = amountA
  for (let i = 1; i < path.length; i++) {
    const { 0: reserveA, 1: reserveB } = await router.getReserves(path[i-1], path[i])
    amountB = calc.swapOutput(amountB, reserveA, reserveB)
  }
  return amountB
}

// calculates the amount of input needed to swap to amountB through path
export async function swapInput(
  router: BlazeSwapRouter,
  path: ERC20[],
  amountB: bigint
): Promise<bigint> {
  let amountA = amountB
  for (let i = path.length - 1; i > 0; i--) {
    const { 0: reserveA, 1: reserveB } = await router.getReserves(path[i-1], path[i])
    amountA = calc.swapInput(amountA, reserveA, reserveB)
  }
  return amountA
}

export async function swap(
  router: BlazeSwapRouter,
  tokenPath: ERC20Mock[],
  amountA: bigint,
  swapper: Signer
): Promise<void> {
  await tokenPath[0].connect(swapper).approve(router, amountA)
  await router.connect(swapper).swapExactTokensForTokens(amountA, 0, tokenPath, swapper, ethers.MaxUint256)
}

////////////////////////////////////////////////////////////////////////////
// f-asset conversions

export function lotSizeUba(fAsset: UnderlyingAsset): bigint {
  return BigInt(fAsset.lotSize) * BigInt(10) ** BigInt(fAsset.decimals)
}

export function lotSizeAmg(fAsset: UnderlyingAsset): bigint {
  return lotSizeUba(fAsset) / amgSizeUba(fAsset)
}

export function amgSizeUba(fAsset: UnderlyingAsset): bigint {
  return BigInt(10) ** BigInt(fAsset.decimals - fAsset.amgDecimals)
}

export function roundDownToAmg(fAsset: UnderlyingAsset, amount: bigint): bigint {
  return amount / amgSizeUba(fAsset) * amgSizeUba(fAsset)
}

export function ubaToAmg(fAsset: UnderlyingAsset, uba: bigint): bigint {
  return uba / amgSizeUba(fAsset)
}

////////////////////////////////////////////////////////////////////////////
// bigint extensions

// not really uniformly random, but it'll do
export function randBigInt(min: bigint, max: bigint): bigint {
  const diff = max - min
  const bitlen = diff.toString(2).length
  const bytelen = Math.ceil(bitlen / 8)
  const randbytes = BigInt("0x" + crypto.randomBytes(bytelen).toString('hex'))
  return min + randbytes % diff
}

export function randBigIntInRadius (center: bigint, radius: bigint): bigint {
  const min = center - radius
  const max = center + radius
  return randBigInt(min, max)
}

export function randBigIntInRelRadius (center: bigint, radiusPerc: number): bigint {
  const radius = center * BigInt(radiusPerc) / BigInt(100)
  return randBigIntInRadius(center, radius)
}