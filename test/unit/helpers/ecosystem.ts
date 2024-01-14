import { expect } from 'chai'
import { addLiquidity } from './dex'
import type { EcosystemConfig, AssetConfig, TestContext } from '../fixtures/interface'
import type { FakePriceReader } from '../../../types'


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
  // mint some initial funds to the liquidator contract
  await context.contracts.fAsset.mint(context.contracts.liquidator, config.initialLiquidatorFAsset)
  await context.contracts.vault.mint(context.contracts.liquidator, config.initialLiquidatorVault)
  await context.contracts.pool.mint(context.contracts.liquidator, config.initialLiquidatorPool)
}
