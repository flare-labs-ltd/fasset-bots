import { expect } from 'chai'
import { ZeroAddress } from 'ethers'
import { ubaToAmg } from './helpers/utils'
import { swapOutput, swapInput, swapOutputs } from './helpers/dex'
import { setupEcosystem, setFtsoPrices } from './helpers/ecosystem'
import { getTestContext } from './fixtures/context'
import { XRP, WFLR, USDT } from './fixtures/assets'
import { EcosystemFactory } from './fixtures/ecosystem'
import type { AssetConfig, CollateralAsset, UnderlyingAsset, EcosystemConfig, TestContext } from './fixtures/interface'
import type { ERC20 } from '../../types'


type ArbitrageSwapPaths = {
  dex1: ERC20[],
  dex2: ERC20[]
}

// contract constants
const AMG_TOKEN_WEI_PRICE_SCALE_EXP = BigInt(9)
const AMG_TOKEN_WEI_PRICE_SCALE = BigInt(10) ** AMG_TOKEN_WEI_PRICE_SCALE_EXP

// config for used assets
const assetConfig: AssetConfig = {
  asset: XRP,
  vault: USDT,
  pool: WFLR
}
// factory for creating various ecosystems
const ecosystemFactory = new EcosystemFactory(assetConfig)
// paths to swap by (could include some more tokens)
const swapPathConfig: string[] = [
  ",",
  "vault -> pool -> fAsset,",
  ", pool -> fAsset -> vault,",
  "vault -> fAsset, pool -> vault",
  "vault -> pool -> fAsset, pool -> vault",
  "vault -> fAsset, pool -> fAsset -> vault",
  "vault -> pool -> fAsset, pool -> fAsset -> vault",
]

describe("Tests for Liquidator contract", () => {
  let context: TestContext

  function nameToToken(name: string): ERC20 {
    switch (name) {
      case "vault": return context.contracts.vault
      case "pool": return context.contracts.pool
      case "fAsset": return context.contracts.fAsset
      default: throw new Error("Invalid token in path")
    }
  }

  function resolveSwapPath(paths: string): ArbitrageSwapPaths {
    const [dex1, dex2] = paths.split(",").map((s) => s.trim())
    return {
      dex1: (dex1 !== "") ? dex1.split("->").map((s) => s.trim()).map(nameToToken) : [],
      dex2: (dex2 !== "") ? dex2.split("->").map((s) => s.trim()).map(nameToToken) : []
    }
  }

  function resolveSwapPathDefaults(paths: ArbitrageSwapPaths): ArbitrageSwapPaths {
    return {
      dex1: (paths.dex1.length > 0) ? paths.dex1 : [context.contracts.vault, context.contracts.fAsset],
      dex2: (paths.dex2.length > 0) ? paths.dex2 : [context.contracts.pool, context.contracts.vault]
    }
  }

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

  async function arbitrageProfit(liquidatedVault: bigint, dex1Path: ERC20[], dex2Path: ERC20[]): Promise<bigint> {
    const { blazeSwapRouter } = context.contracts
    const fAssets = await swapOutput(blazeSwapRouter, dex1Path, liquidatedVault)
    const [vaultProfit, poolProfit] = await liquidationOutput(fAssets)
    const [, poolProfitSwapped] = await swapOutputs(blazeSwapRouter, [dex1Path, dex2Path], [liquidatedVault, poolProfit])
    return vaultProfit + poolProfitSwapped - liquidatedVault
  }

  beforeEach(async function () {
    context = await getTestContext(assetConfig)
  })

  describe("test arbitrage on various ecosystems", () => {

    swapPathConfig.forEach((swapPaths) => {
      ecosystemFactory.getHealthyEcosystems(8).forEach((config: EcosystemConfig) => {
        it(`should fully liquidate an agent in a healthy ecosystem config: "${config.name}" with swap path "${swapPaths}"`, async () => {
          const paths = resolveSwapPath(swapPaths)
          const fullPaths = resolveSwapPathDefaults(paths)
          const { contracts, signers } = context
          await setupEcosystem(assetConfig, config, context)
          // perform arbitrage by liquidation
          const { maxLiquidationAmountUBA: maxLiquidatedFAsset } = await contracts.assetManager.getAgentInfo(contracts.agent)
          expect(maxLiquidatedFAsset).to.be.greaterThan(0) // check that agent is in liquidation
          const maxLiquidatedVault = await swapInput(contracts.blazeSwapRouter, fullPaths.dex1, maxLiquidatedFAsset)
          const [expectedLiquidationRewardVault, expectedLiquidationRewardPool] = await liquidationOutput(maxLiquidatedFAsset)
          const [,expectedSwappedPool] = await swapOutputs(
            contracts.blazeSwapRouter, [fullPaths.dex1, fullPaths.dex2], [maxLiquidatedVault, expectedLiquidationRewardPool])
          const { mintedUBA: mintedFAssetBefore } = await contracts.assetManager.getAgentInfo(contracts.agent)
          const agentVaultBalanceBefore = await contracts.vault.balanceOf(contracts.agent)
          const agentPoolBalanceBefore = await contracts.pool.balanceOf(contracts.agent)
          await contracts.liquidator.connect(signers.liquidator).runArbitrage(
            contracts.agent,
            signers.rewardee,
            0, 1, 0, 1,
            ZeroAddress,
            ZeroAddress,
            paths.dex1,
            paths.dex2
          )
          const { mintedUBA: mintedFAssetAfter } = await contracts.assetManager.getAgentInfo(contracts.agent)
          const agentVaultBalanceAfter = await contracts.vault.balanceOf(contracts.agent)
          const agentPoolBalanceAfter = await contracts.pool.balanceOf(contracts.agent)
          // check that max fAsset was liquidated (this relies on constructed state settings)
          const liquidatedFAsset = mintedFAssetBefore - mintedFAssetAfter
          expect(liquidatedFAsset).to.equal(maxLiquidatedFAsset)
          // check that both collateral ratios are again above their minimums
          const { vaultCollateralRatioBIPS: crVaultAfterLiq, poolCollateralRatioBIPS: crPoolAfterLiq }
            = await contracts.assetManager.getAgentInfo(contracts.agent)
          expect(crVaultAfterLiq).to.be.greaterThanOrEqual(assetConfig.vault.minCollateralRatioBips)
          expect(crPoolAfterLiq).to.be.greaterThanOrEqual(assetConfig.pool.minCollateralRatioBips)
          // check that agent lost appropriate amounts of both collaterals
          const agentVaultLoss = agentVaultBalanceBefore - agentVaultBalanceAfter
          expect(agentVaultLoss).to.equal(expectedLiquidationRewardVault)
          const agentPoolLoss = agentPoolBalanceBefore - agentPoolBalanceAfter
          expect(agentPoolLoss).to.equal(expectedLiquidationRewardPool)
          // check that redeemer was compensated by agent's lost vault collateral
          const expectedVaultEarnings = expectedLiquidationRewardVault + expectedSwappedPool - maxLiquidatedVault
          const earnings = await contracts.vault.balanceOf(signers.rewardee)
          expect(earnings).to.equal(expectedVaultEarnings)
          // check that liquidator contract had not had any funds stolen or given
          const fAssetBalanceLiquidatorContract = await contracts.fAsset.balanceOf(contracts.liquidator)
          expect(fAssetBalanceLiquidatorContract).to.equal(config.initialLiquidatorFAsset)
          const poolBalanceLiquidatorContract = await contracts.pool.balanceOf(contracts.liquidator)
          expect(poolBalanceLiquidatorContract).to.equal(config.initialLiquidatorPool)
          const vaultBalanceLiquidatorContract = await contracts.vault.balanceOf(contracts.liquidator)
          expect(vaultBalanceLiquidatorContract).to.equal(config.initialLiquidatorVault)
        })
      })

      ecosystemFactory.getSemiHealthyEcosystems(8).forEach((config: EcosystemConfig) => {
        it.only(`should optimally liquidate less than max f-assets due to semi-healthy ecosystem config: "${config.name}" with swap path "${swapPaths}"`, async () => {
          const paths = resolveSwapPath(swapPaths)
          const fullPaths = resolveSwapPathDefaults(paths)
          const { contracts, signers } = context
          await setupEcosystem(assetConfig, config, context)
          // calculate full liquidation profit
          const { maxLiquidationAmountUBA: maxLiquidatedFAsset } = await contracts.assetManager.getAgentInfo(contracts.agent)
          const maxLiquidatedVault = await swapInput(contracts.blazeSwapRouter, fullPaths.dex1, maxLiquidatedFAsset)
          const fullLiquidationProfit = await arbitrageProfit(maxLiquidatedVault, fullPaths.dex1, fullPaths.dex2)
          // perform arbitrage by liquidation
          const { mintedUBA: mintedFAssetBefore } = await contracts.assetManager.getAgentInfo(contracts.agent)
          const agentVaultBalanceBefore = await contracts.vault.balanceOf(contracts.agent)
          const agentPoolBalanceBefore = await contracts.pool.balanceOf(contracts.agent)
          await contracts.liquidator.connect(signers.liquidator).runArbitrage(
            contracts.agent,
            signers.rewardee,
            0, 1, 0, 1,
            ZeroAddress,
            ZeroAddress,
            paths.dex1,
            paths.dex2
          )
          const { mintedUBA: mintedFAssetAfter } = await contracts.assetManager.getAgentInfo(contracts.agent)
          const agentVaultBalanceAfter = await contracts.vault.balanceOf(contracts.agent)
          const agentPoolBalanceAfter = await contracts.pool.balanceOf(contracts.agent)
          // check that executed liquidation was more profitable than the full one would have been
          const liquidatedFAsset = mintedFAssetBefore - mintedFAssetAfter
          const usedVault = agentVaultBalanceBefore - agentVaultBalanceAfter
          const usedPool = agentPoolBalanceBefore - agentPoolBalanceAfter
          const swappedVault = await swapOutput(contracts.blazeSwapRouter, [contracts.vault, contracts.fAsset], liquidatedFAsset)
          const profit = swappedVault + usedPool - usedVault
          console.log(profit)
          expect(profit).to.be.greaterThanOrEqual(fullLiquidationProfit)
        })
      })

      it("should fail the arbitrage if there is bad debt", async () => {
        const paths = resolveSwapPath(swapPaths)
        const fullPaths = resolveSwapPathDefaults(paths)
        const config = ecosystemFactory.unhealthyEcosystemWithBadDebt
        const { contracts, signers } = context
        await setupEcosystem(assetConfig, config, context)
        await expect(contracts.liquidator.connect(signers.liquidator).runArbitrage(
          contracts.agent,
          signers.rewardee,
          0, 1, 0, 1,
          ZeroAddress,
          ZeroAddress,
          fullPaths.dex1,
          fullPaths.dex2
        )).to.be.revertedWith("Liquidator: No profit available")
      })
    })

    it("should fail arbitrage with badly liquidated path and then succeed through bypassing that path", async () => {
      const badPaths = resolveSwapPath("vault -> fAsset, pool -> vault")
      const config = ecosystemFactory.unhealthyEcosystemWithHighVaultFAssetDexPrice
      const { contracts, signers } = context
      await setupEcosystem(assetConfig, config, context)
      await expect(contracts.liquidator.connect(signers.liquidator).runArbitrage(
        contracts.agent,
        signers.rewardee,
        0, 1, 0, 1,
        ZeroAddress,
        ZeroAddress,
        badPaths.dex1,
        badPaths.dex2
      )).to.be.revertedWith("Liquidator: No profit available")
      // bypass the broken vault -> f-asset path with vault -> pool -> f-asset
      const goodPaths = resolveSwapPath("vault -> pool -> fAsset, pool -> vault")
      await contracts.liquidator.connect(signers.liquidator).runArbitrage(
        contracts.agent,
        signers.rewardee,
        0, 1, 0, 1,
        ZeroAddress,
        ZeroAddress,
        goodPaths.dex1,
        goodPaths.dex2
      )
      const profit = await contracts.vault.balanceOf(signers.rewardee)
      expect(profit).to.be.greaterThan(0)
    })

  })

  describe("generic arbitrage failures", async () => {

    it("should fail liquidation if flash loan can offer 0 fees", async () => {
      const { contracts, signers } = context
      await setupEcosystem(assetConfig, ecosystemFactory.healthyEcosystemWithVaultUnderwater, context)
      await contracts.vault.burn(contracts.flashLender, await contracts.vault.balanceOf(contracts.flashLender))
      await expect(contracts.liquidator.connect(signers.liquidator).runArbitrage(
        context.contracts.agent, context.signers.rewardee, 0, 1, 0, 1, ZeroAddress, ZeroAddress, [], []
      )).to.be.revertedWith("Liquidator: Flash loan unavailable")
    })

    it("should fail if agent is not in liquidation", async () => {
      await setupEcosystem(assetConfig, ecosystemFactory.baseEcosystem, context)
      await expect(context.contracts.liquidator.connect(context.signers.liquidator).runArbitrage(
        context.contracts.agent, context.signers.rewardee, 0, 1, 0, 1, ZeroAddress, ZeroAddress, [], []
      )).to.be.revertedWith("Liquidator: No f-asset to liquidate")
    })

    it("should fail when given incorrect liquidation paths", async () => {
      await setupEcosystem(assetConfig, ecosystemFactory.healthyEcosystemWithVaultUnderwater, context)
      await expect(context.contracts.liquidator.connect(context.signers.liquidator).runArbitrage(
        context.contracts.agent,
        context.signers.rewardee,
        0, 1,
        0, 1,
        ZeroAddress,
        ZeroAddress,
        [context.contracts.vault, context.contracts.pool],
        [context.contracts.pool, context.contracts.vault]
      )).to.be.revertedWith("Liquidator: Invalid vault to f-asset dex path")
      await expect(context.contracts.liquidator.connect(context.signers.liquidator).runArbitrage(
        context.contracts.agent,
        context.signers.rewardee,
        0, 1,
        0, 1,
        ZeroAddress,
        ZeroAddress,
        [context.contracts.vault, context.contracts.pool, context.contracts.fAsset],
        [context.contracts.pool, context.contracts.fAsset]
      )).to.be.revertedWith("Liquidator: Invalid pool to vault dex path")
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