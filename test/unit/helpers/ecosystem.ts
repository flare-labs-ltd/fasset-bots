import { expect } from 'chai'
import { ubaToAmg } from './utils'
import { addLiquidity, swapOutput, swapOutputs } from './dex'
import type { UnderlyingAsset, CollateralAsset } from '../fixtures/interface'
import type { EcosystemConfig, AssetConfig, TestContext } from '../fixtures/interface'
import type { ERC20 } from '../../../types'


// contract constants
const AMG_TOKEN_WEI_PRICE_SCALE_EXP = BigInt(9)
const AMG_TOKEN_WEI_PRICE_SCALE = BigInt(10) ** AMG_TOKEN_WEI_PRICE_SCALE_EXP

export class TestUtils {

  constructor(
    private assetConfig: AssetConfig,
    private context: TestContext
  ) {}

  // prices expressed in e.g. usd
  async setFtsoPrices(
    priceAsset: bigint,
    priceVault: bigint,
    pricePool: bigint
  ): Promise<void> {
    const priceReader = this.context.contracts.priceReader
    await priceReader.setPrice(this.assetConfig.asset.ftsoSymbol, priceAsset)
    await priceReader.setPrice(this.assetConfig.vault.ftsoSymbol, priceVault)
    await priceReader.setPrice(this.assetConfig.pool.ftsoSymbol, pricePool)
  }

  async configureEcosystem(config: EcosystemConfig): Promise<void> {
    const { contracts, signers } = this.context
    const { assetManager, blazeSwapRouter, fAsset, vault, pool, agent } = contracts
    // set ftso prices and dex reserves (pool-fAsset is needed only for testing swaps through non-arbitrary paths)
    await assetManager.setLiquidationFactors(config.liquidationFactorBips, config.liquidationFactorVaultBips)
    await this.setFtsoPrices(config.assetFtsoPrice, config.vaultFtsoPrice, config.poolFtsoPrice)
    await addLiquidity(blazeSwapRouter, vault, fAsset, config.dex1VaultReserve, config.dex1FAssetReserve, signers.deployer)
    await addLiquidity(blazeSwapRouter, pool, vault, config.dex2PoolReserve, config.dex2VaultReserve, signers.deployer)
    await addLiquidity(blazeSwapRouter, pool, fAsset, config.dex3PoolReserve, config.dex3FAssetReserve, signers.deployer)
    // deposit collaterals and mint
    await agent.depositVaultCollateral(config.vaultCollateral)
    await agent.depositPoolCollateral(config.poolCollateral)
    await agent.mint(signers.fAssetMinter, config.mintedUBA)
    // put agent in full liquidation if configured so (this implies agent did an illegal operation)
    if (config.fullLiquidation) await assetManager.putAgentInFullLiquidation(agent)
    const { status, vaultCollateralRatioBIPS, poolCollateralRatioBIPS } = await assetManager.getAgentInfo(agent)
    expect(status).to.equal(config.fullLiquidation ? 3 : 0)
    // check that agent cr is as expected
    expect(vaultCollateralRatioBIPS).to.be.closeTo(config.expectedVaultCrBips, 1)
    expect(poolCollateralRatioBIPS).to.be.closeTo(config.expectedPoolCrBips, 1)
    // mint some initial funds to the liquidator contract
    await contracts.fAsset.mint(contracts.liquidator, config.initialLiquidatorFAsset)
    await contracts.vault.mint(contracts.liquidator, config.initialLiquidatorVault)
    await contracts.pool.mint(contracts.liquidator, config.initialLiquidatorPool)
  }

  async arbitrageProfit(liquidatedVault: bigint, dex1Path: ERC20[], dex2Path: ERC20[]): Promise<bigint> {
    const { contracts } = this.context
    const fAssets = await swapOutput(contracts.blazeSwapRouter, dex1Path, liquidatedVault)
    const [vaultProfit, poolProfit] = await this.liquidationOutput(fAssets)
    const [, poolProfitSwapped] = await swapOutputs(
      contracts.blazeSwapRouter, [dex1Path, dex2Path], [liquidatedVault, poolProfit])
    return vaultProfit + poolProfitSwapped - liquidatedVault
  }

  // this is how prices are calculated in the asset manager contract
  async amgToTokenPrice(fAsset: UnderlyingAsset, collateral: CollateralAsset): Promise<bigint> {
    const { contracts } = this.context
    const { 0: collateralFtsoPrice, 2: collateralFtsoDecimals }
      = await contracts.priceReader.getPrice(collateral.ftsoSymbol)
    const { 0: fAssetFtsoPrice, 2: fAssetFtsoDecimals }
      = await contracts.priceReader.getPrice(fAsset.ftsoSymbol)
    const expPlus = collateralFtsoDecimals + collateral.decimals + AMG_TOKEN_WEI_PRICE_SCALE_EXP
    const expMinus = fAssetFtsoDecimals + fAsset.amgDecimals
    const scale = BigInt(10) ** (expPlus - expMinus)
    return fAssetFtsoPrice * scale / collateralFtsoPrice
  }

  amgToToken(amgAmount: bigint, amgPriceTokenWei: bigint): bigint {
    return amgAmount * amgPriceTokenWei / AMG_TOKEN_WEI_PRICE_SCALE
  }

  async liquidationOutput(amountFAssetUba: bigint): Promise<[bigint, bigint]> {
    const { contracts } = this.context
    const { liquidationPaymentFactorVaultBIPS, liquidationPaymentFactorPoolBIPS }
      = await contracts.assetManager.getAgentInfo(contracts.agent)
    const amountFAssetAmg = ubaToAmg(this.assetConfig.asset, amountFAssetUba)
    // for vault
    const amgPriceVault = await this.amgToTokenPrice(this.assetConfig.asset, this.assetConfig.vault)
    const amgWithVaultFactor = amountFAssetAmg * liquidationPaymentFactorVaultBIPS / BigInt(10_000)
    const amountVault = this.amgToToken(amgWithVaultFactor, amgPriceVault)
    // for pool
    const amgPricePool = await this.amgToTokenPrice(this.assetConfig.asset, this.assetConfig.pool)
    const amgWithPoolFactor = amountFAssetAmg * liquidationPaymentFactorPoolBIPS / BigInt(10_000)
    const amountPool = this.amgToToken(amgWithPoolFactor, amgPricePool)
    return [amountVault, amountPool]
  }

}
