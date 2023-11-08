import { expect } from 'chai'
import { ubaToAmg, swapOutput, swapInput, setupEcosystem, setFtsoPrices } from './helpers/utils'
import { getTestContext } from './fixtures/context'
import { XRP, WFLR, USDT } from './fixtures/assets'
import { EcosystemFactory } from './fixtures/ecosystem'
import type { AssetConfig, CollateralAsset, UnderlyingAsset, EcosystemConfig, TestContext } from './fixtures/interface'


// config for used assets
const assetConfig: AssetConfig = {
  asset: XRP,
  vault: USDT,
  pool: WFLR
}
// factory for creating various ecosystems
const ecosystemFactory = new EcosystemFactory(assetConfig)
// contract constants
const AMG_TOKEN_WEI_PRICE_SCALE_EXP = BigInt(9)
const AMG_TOKEN_WEI_PRICE_SCALE = BigInt(10) ** AMG_TOKEN_WEI_PRICE_SCALE_EXP

describe("Tests for Liquidator contract", () => {
  let context: TestContext

  async function liquidationOutput(amountFAssetUba: bigint): Promise<[bigint, bigint]> {
    const { agent, assetManager } = context.contracts
    const { liquidationPaymentFactorVaultBIPS, liquidationPaymentFactorPoolBIPS }
      = await assetManager.getAgentInfo(agent)
    const amountFAssetAmg = ubaToAmg(assetConfig.asset, amountFAssetUba)
    // for vault
    const amgPriceVault = await calcAmgToTokenWeiPrice(assetConfig.vault)
    const amgWithVaultFactor = amountFAssetAmg * liquidationPaymentFactorVaultBIPS / BigInt(10_000)
    const amountVault = amgToTokenWei(amgWithVaultFactor, amgPriceVault)
    // for pool
    const amgPricePool = await calcAmgToTokenWeiPrice(assetConfig.pool)
    const amgWithPoolFactor = amountFAssetAmg * liquidationPaymentFactorPoolBIPS / BigInt(10_000)
    const amountPool = amgToTokenWei(amgWithPoolFactor, amgPricePool)
    return [amountVault, amountPool]
  }

  // this is how prices are calculated in the asset manager contract
  async function calcAmgToTokenWeiPrice(collateral: CollateralAsset): Promise<bigint> {
    const { 0: collateralFtsoPrice, 2: collateralFtsoDecimals }
      = await context.contracts.priceReader.getPrice(collateral.ftsoSymbol)
    const { 0: fAssetFtsoPrice, 2: fAssetFtsoDecimals }
      = await context.contracts.priceReader.getPrice(assetConfig.asset.ftsoSymbol)
    const expPlus = collateralFtsoDecimals + collateral.decimals + AMG_TOKEN_WEI_PRICE_SCALE_EXP
    const expMinus = fAssetFtsoDecimals + assetConfig.asset.amgDecimals
    const scale = BigInt(10) ** (expPlus - expMinus)
    return fAssetFtsoPrice * scale / collateralFtsoPrice
  }

  function amgToTokenWei(amgAmount: bigint, amgPriceTokenWei: bigint): bigint {
    return amgAmount * amgPriceTokenWei / AMG_TOKEN_WEI_PRICE_SCALE
  }

  // this is how prices are calculated in the liquidator contract
  async function calcTokenATokenBPriceMulDiv(
    assetA: CollateralAsset | UnderlyingAsset,
    assetB: CollateralAsset | UnderlyingAsset
  ): Promise<[bigint, bigint]> {
    const { 0: assetAPrice, 2: assetAFtsoDecimals }
      = await context.contracts.priceReader.getPrice(assetA.ftsoSymbol)
    const { 0: assetBPrice, 2: assetBFtsoDecimals }
      = await context.contracts.priceReader.getPrice(assetB.ftsoSymbol)
    return [
      assetAPrice * BigInt(10) ** (assetBFtsoDecimals + assetB.decimals),
      assetBPrice * BigInt(10) ** (assetAFtsoDecimals + assetA.decimals)
    ]
  }

  async function arbitrageProfit(liquidatedVault: bigint): Promise<bigint> {
    const { blazeSwapRouter, fAsset, vault, pool } = context.contracts
    const fAssets = await swapOutput(blazeSwapRouter, vault, fAsset, liquidatedVault)
    const [vaultProfit, poolProfit] = await liquidationOutput(fAssets)
    const poolProfitSwapped = await swapOutput(blazeSwapRouter, pool, vault, poolProfit)
    return vaultProfit + poolProfitSwapped - liquidatedVault
  }

  beforeEach(async function () {
    context = await getTestContext(assetConfig)
  })

  describe("scenarios with random ecosystems", () => {

    ecosystemFactory.getHealthyEcosystems(20).forEach((config: EcosystemConfig) => {
      it(`should fully liquidate an agent in a healthy ecosystem config: ${config.name}`, async () => {
        const { assetManager, agent, blazeSwapRouter, fAsset, vault, pool, liquidator } = context.contracts
        // setup ecosystem
        await setupEcosystem(config, assetConfig, context)
        // perform arbitrage by liquidation
        const { maxLiquidationAmountUBA: maxLiquidatedFAsset } = await assetManager.getAgentInfo(agent)
        expect(maxLiquidatedFAsset).to.be.greaterThan(0) // check that agent is in liquidation
        const maxLiquidatedVault = await swapInput(blazeSwapRouter, vault, fAsset, maxLiquidatedFAsset)
        const [expectedLiqVault, expectedLiqPool] = await liquidationOutput(maxLiquidatedFAsset)
        const expectedSwappedPool = await swapOutput(blazeSwapRouter, pool, vault, expectedLiqPool)
        const { mintedUBA: mintedFAssetBefore } = await assetManager.getAgentInfo(agent)
        const agentVaultBalanceBefore = await vault.balanceOf(agent)
        const agentPoolBalanceBefore = await pool.balanceOf(agent)
        await liquidator.connect(context.signers.liquidator).runArbitrage(agent)
        const { mintedUBA: mintedFAssetAfter } = await assetManager.getAgentInfo(agent)
        const agentVaultBalanceAfter = await vault.balanceOf(agent)
        const agentPoolBalanceAfter = await pool.balanceOf(agent)
        // check that max fAsset was liquidated (this relies on constructed state settings)
        const liquidatedFAsset = mintedFAssetBefore - mintedFAssetAfter
        expect(liquidatedFAsset).to.equal(maxLiquidatedFAsset)
        // check that both collateral ratios are again above their minimums
        const { vaultCollateralRatioBIPS: crVaultAfterLiq, poolCollateralRatioBIPS: crPoolAfterLiq }
          = await assetManager.getAgentInfo(agent)
        expect(crVaultAfterLiq).to.be.greaterThanOrEqual(assetConfig.vault.minCollateralRatioBips)
        expect(crPoolAfterLiq).to.be.greaterThanOrEqual(assetConfig.pool.minCollateralRatioBips)
        // check that agent lost appropriate amounts of both collaterals
        const agentVaultLoss = agentVaultBalanceBefore - agentVaultBalanceAfter
        expect(agentVaultLoss).to.equal(expectedLiqVault)
        const agentPoolLoss = agentPoolBalanceBefore - agentPoolBalanceAfter
        expect(agentPoolLoss).to.equal(expectedLiqPool)
        // check that redeemer was compensated by agent's lost vault collateral
        const expectedVaultEarnings = expectedLiqVault + expectedSwappedPool - maxLiquidatedVault
        const earnings = await vault.balanceOf(context.signers.liquidator)
        expect(earnings).to.equal(expectedVaultEarnings)
        // check that liquidator contract has no leftover funds
        const fAssetBalanceLiquidatorContract = await fAsset.balanceOf(liquidator)
        expect(fAssetBalanceLiquidatorContract).to.equal(0)
        const poolBalanceLiquidatorContract = await pool.balanceOf(liquidator)
        expect(poolBalanceLiquidatorContract).to.equal(0)
        const vaultBalanceLiquidatorContract = await vault.balanceOf(liquidator)
        expect(vaultBalanceLiquidatorContract).to.equal(0)
      })
    })

    ecosystemFactory.getSemiHealthyEcosystems(1).forEach((config: EcosystemConfig) => {
      it(`should optimally liquidate less than max f-assets due to semi-healthy ecosystem config: ${config.name}`, async () => {
        const { assetManager, agent, blazeSwapRouter, fAsset, vault, pool, liquidator } = context.contracts
        // setup ecosystem
        await setupEcosystem(config, assetConfig, context)
        // calculate full liquidation profit
        const { maxLiquidationAmountUBA: maxLiquidatedFAsset } = await assetManager.getAgentInfo(agent)
        const maxLiquidatedVault = await swapInput(blazeSwapRouter, vault, fAsset, maxLiquidatedFAsset)
        const fullLiquidationProfit = await arbitrageProfit(maxLiquidatedVault)
        // perform arbitrage by liquidation
        const { mintedUBA: mintedFAssetBefore } = await assetManager.getAgentInfo(agent)
        const agentVaultBalanceBefore = await vault.balanceOf(agent)
        const agentPoolBalanceBefore = await pool.balanceOf(agent)
        await liquidator.connect(context.signers.liquidator).runArbitrage(agent)
        const { mintedUBA: mintedFAssetAfter } = await assetManager.getAgentInfo(agent)
        const agentVaultBalanceAfter = await vault.balanceOf(agent)
        const agentPoolBalanceAfter = await pool.balanceOf(agent)
        // check that executed liquidation was more profitable than the full one would have been
        const liquidatedFAsset = mintedFAssetBefore - mintedFAssetAfter
        const usedVault = agentVaultBalanceBefore - agentVaultBalanceAfter
        const usedPool = agentPoolBalanceBefore - agentPoolBalanceAfter
        const swappedVault = await swapOutput(blazeSwapRouter, vault, fAsset, liquidatedFAsset)
        const profit = swappedVault + usedPool - usedVault
        expect(profit).to.be.greaterThanOrEqual(fullLiquidationProfit)
      })
    })

    ecosystemFactory.getUnhealthyEcosystems(1).forEach((config: EcosystemConfig) => {
      it(`should fail at arbitrage liquidation due to unhealthy ecosystem config: ${config.name}`, async () => {
        await setupEcosystem(config, assetConfig, context)
        await expect(context.contracts.liquidator.runArbitrage(context.contracts.agent)).to.be.revertedWith(
          "Liquidator: No profit available")
      })
    })
  })

  describe("general liquidation failures", async () => {

    it("should fail liquidation if flash loan can offer 0 fees", async () => {
      const { vault, flashLender, liquidator, agent } = context.contracts
      await setupEcosystem(ecosystemFactory.healthyEcosystemWithVaultUnderwater, assetConfig, context)
      await vault.burn(flashLender, await vault.balanceOf(flashLender))
      await expect(liquidator.runArbitrage(agent)).to.be.revertedWith("Liquidator: Flash loan unavailable")
    })

    it("should fail if agent is not in liquidation", async () => {
      const { liquidator, agent } = context.contracts
      await setupEcosystem(ecosystemFactory.baseEcosystem, assetConfig, context)
      await expect(liquidator.runArbitrage(agent)).to.be.revertedWith("Liquidator: No f-asset to liquidate")
    })

  })

  describe("calculation", () => {
    it("should test calculating asset price in pool token in two ways", async () => {
      await setFtsoPrices(
        assetConfig,
        context.contracts.priceReader,
        assetConfig.asset.defaultPriceUsd5,
        assetConfig.vault.defaultPriceUsd5,
        assetConfig.pool.defaultPriceUsd5
      )
      for (let collateral of [assetConfig.pool, assetConfig.vault]) {
        const price1 = await calcAmgToTokenWeiPrice(collateral)
        const [price2Mul, price2Div] = await calcTokenATokenBPriceMulDiv(assetConfig.asset, collateral)
        const amountUBA = BigInt(1_000_000_000)
        const amountWei1 = amgToTokenWei(ubaToAmg(assetConfig.asset, amountUBA), price1)
        const amountWei2 = amountUBA * price2Mul / price2Div
        expect(amountWei1).to.equal(amountWei2)
      }
    })
  })

  describe("security", () => {

    it("should prevent direct external call to onFlashLoan", async () => {
      const { liquidator } = context.contracts
      await expect(liquidator.onFlashLoan(
        context.signers.challenger.address,
        context.contracts.vault,
        1000,
        1000,
        "0x"
      )).to.be.revertedWith("Liquidator: Flash loan with invalid initiator")
    })
  })
})