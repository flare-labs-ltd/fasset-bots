import { expect } from 'chai'
import { ZeroAddress } from 'ethers'
import { ubaToAmg } from './helpers/utils'
import { swapInput, swapOutputs } from './helpers/dex'
import { TestUtils } from './helpers/ecosystem'
import { getTestContext } from './fixtures/context'
import { XRP, WFLR, USDT } from './fixtures/assets'
import { EcosystemFactory } from './fixtures/ecosystem'
import type { AssetConfig, EcosystemConfig, TestContext } from './fixtures/interface'
import type { ERC20 } from '../../types'


type ArbitrageSwapPaths = {
  dex1: ERC20[],
  dex2: ERC20[]
}

// config for used assets
const assetConfig: AssetConfig = {
  asset: XRP,
  vault: USDT,
  pool: WFLR
}
// factory for creating various ecosystems
const ecosystemFactory = new EcosystemFactory(assetConfig)
// paths to swap by (could include some external tokens)
const swapPathsFixture: string[] = [
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
  let utils: TestUtils

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

  beforeEach(async function () {
    context = await getTestContext(assetConfig)
    utils = new TestUtils(assetConfig, context)
  })

  describe("test arbitrage on various ecosystems", () => {

    swapPathsFixture.slice(1,2).forEach((swapPaths) => {
      ecosystemFactory.getHealthyEcosystems(8).forEach((config: EcosystemConfig) => {
        it(`should fully liquidate an agent in a healthy ecosystem config: "${config.name}" with swap path "${swapPaths}"`, async () => {
          const paths = resolveSwapPath(swapPaths)
          const fullPaths = resolveSwapPathDefaults(paths)
          const { contracts, signers } = context
          await utils.configureEcosystem(config)
          // perform arbitrage by liquidation
          const { maxLiquidationAmountUBA: maxLiquidatedFAsset } = await contracts.assetManager.getAgentInfo(contracts.agent)
          expect(maxLiquidatedFAsset).to.be.greaterThan(0) // check that agent is in liquidation
          const maxLiquidatedVault = await swapInput(contracts.blazeSwapRouter, fullPaths.dex1, maxLiquidatedFAsset)
          const [expectedLiquidationRewardVault, expectedLiquidationRewardPool] = await utils.liquidationOutput(maxLiquidatedFAsset)
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

      ecosystemFactory.getSemiHealthyEcosystems(1).forEach((config: EcosystemConfig) => {
        it.only(`should optimally liquidate less than max f-assets due to semi-healthy ecosystem config: "${config.name}" with swap path "${swapPaths}"`, async () => {
          const paths = resolveSwapPath(swapPaths)
          const fullPaths = resolveSwapPathDefaults(paths)
          const { contracts, signers } = context
          await utils.configureEcosystem(config)

          console.log(await utils.arbitrageProfit(BigInt("1008012833796544491803220"), fullPaths.dex1, fullPaths.dex2))
          console.log(await swapInput(contracts.blazeSwapRouter, fullPaths.dex1, BigInt("1999933865300")))

          // calculate full liquidation profit
          const { maxLiquidationAmountUBA: maxLiquidatedFAsset } = await contracts.assetManager.getAgentInfo(contracts.agent)
          const maxLiquidatedVault = await swapInput(contracts.blazeSwapRouter, fullPaths.dex1, maxLiquidatedFAsset)
          const fullLiquidationProfit = await utils.arbitrageProfit(maxLiquidatedVault, fullPaths.dex1, fullPaths.dex2)
          // perform arbitrage by liquidation
          await contracts.liquidator.connect(signers.liquidator).runArbitrage(
            contracts.agent,
            signers.rewardee,
            0, 1, 0, 1,
            ZeroAddress,
            ZeroAddress,
            paths.dex1,
            paths.dex2
          )
          // check that executed liquidation was more profitable than the full one would have been
          const profit = await contracts.vault.balanceOf(signers.rewardee)
          console.log("max profit", profit)
          expect(profit).to.be.greaterThanOrEqual(fullLiquidationProfit)
        })
      })

      it("should fail the arbitrage in the case of bad debt", async () => {
        const fullPaths = resolveSwapPathDefaults(resolveSwapPath(swapPaths))
        const config = ecosystemFactory.unhealthyEcosystemWithBadDebt
        const { contracts, signers } = context
        await utils.configureEcosystem(config)
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
      const config = ecosystemFactory.unhealthyEcosystemWithHighVaultFAssetDexPrice
      const { contracts, signers } = context
      await utils.configureEcosystem(config)
      await expect(contracts.liquidator.connect(signers.liquidator).runArbitrage(
        contracts.agent, signers.rewardee, 0, 1, 0, 1, ZeroAddress, ZeroAddress, [], []
      )).to.be.revertedWith("Liquidator: No profit available")
      // bypass the broken vault -> f-asset path with vault -> pool -> f-asset
      await contracts.liquidator.connect(signers.liquidator).runArbitrage(
        contracts.agent,
        signers.rewardee,
        0, 1, 0, 1,
        ZeroAddress,
        ZeroAddress,
        [contracts.vault, contracts.pool, contracts.fAsset],
        [contracts.pool, contracts.vault]
      )
      const profit = await contracts.vault.balanceOf(signers.rewardee)
      expect(profit).to.be.greaterThan(0)
    })

    it("should fail arbitrage with dexes price falling lower than specified min price", async () => {
      // TODO
    })

  })

  describe("generic arbitrage failures", async () => {

    it("should fail liquidation if flash loan can offer 0 fees", async () => {
      const { contracts, signers } = context
      await utils.configureEcosystem(ecosystemFactory.healthyEcosystemWithVaultUnderwater)
      await contracts.vault.burn(contracts.flashLender, await contracts.vault.balanceOf(contracts.flashLender))
      await expect(contracts.liquidator.connect(signers.liquidator).runArbitrage(
        context.contracts.agent, context.signers.rewardee, 0, 1, 0, 1, ZeroAddress, ZeroAddress, [], []
      )).to.be.revertedWith("Liquidator: Flash loan unavailable")
    })

    it("should fail if agent is not in liquidation", async () => {
      await utils.configureEcosystem(ecosystemFactory.baseEcosystem)
      await expect(context.contracts.liquidator.connect(context.signers.liquidator).runArbitrage(
        context.contracts.agent, context.signers.rewardee, 0, 1, 0, 1, ZeroAddress, ZeroAddress, [], []
      )).to.be.revertedWith("Liquidator: No f-asset to liquidate")
    })

    it("should fail when given incorrect liquidation paths", async () => {
      await utils.configureEcosystem(ecosystemFactory.healthyEcosystemWithVaultUnderwater)
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
      await utils.setFtsoPrices(
        assetConfig.asset.defaultPriceUsd5,
        assetConfig.vault.defaultPriceUsd5,
        assetConfig.pool.defaultPriceUsd5
      )
      for (let collateral of [assetConfig.pool, assetConfig.vault]) {
        const price1 = await utils.calcAmgToTokenWeiPrice(assetConfig.asset, collateral)
        const [price2Mul, price2Div] = await utils.calcTokenATokenBPriceMulDiv(assetConfig.asset, collateral)
        const amountUBA = BigInt(1_000_000_000)
        const amountWei1 = utils.amgToTokenWei(ubaToAmg(assetConfig.asset, amountUBA), price1)
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