import { expect } from 'chai'
import { ZeroAddress } from 'ethers'
import { applySlippageToDexPrice } from '../calculations/calculations'
import { swapInput, consecutiveSwapOutputs } from './utils/uniswap-v2'
import { ContextUtils } from './utils/context'
import { getTestContext } from './fixtures/context'
import { storeTestResult } from './utils/graph'
import { XRP, WFLR, USDT } from './fixtures/assets'
import { EcosystemFactory } from './fixtures/ecosystem'
import type { AssetConfig, EcosystemConfig, TestContext } from './fixtures/interfaces'
import type { ERC20 } from '../../types'

type SwapPathsFixture = [string[], string[]]
type SwapPaths = [ERC20[], ERC20[]]

// config for used assets
const assetConfig: AssetConfig = {
  asset: XRP,
  vault: USDT,
  pool: WFLR
}
// factory for creating various ecosystems
const ecosystemFactory = new EcosystemFactory(assetConfig)
// paths to swap by (could include some external tokens)
const swapPathsFixture: SwapPathsFixture[] = [
  [["vault", "fAsset"], ["pool", "vault"]],
  [["vault", "pool", "fAsset"], ["pool", "vault"]],
  [["vault", "fAsset"], ["pool", "fAsset", "vault"]],
  [["vault", "pool", "fAsset"], ["pool", "fAsset", "vault"]]
]

describe("Tests for the Liquidator contract", () => {
  let context: TestContext
  let utils: ContextUtils

  function nameToToken(name: string): ERC20 {
    switch (name) {
      case "vault": return context.contracts.vault
      case "pool": return context.contracts.pool
      case "fAsset": return context.contracts.fAsset
      default: throw new Error("Invalid token in path")
    }
  }

  function resolveSwapPath(paths: SwapPathsFixture): SwapPaths {
    const [path1, path2] = paths
    return [path1.map(s => nameToToken(s)), path2.map(s => nameToToken(s))]
  }

  beforeEach(async function () {
    context = await getTestContext(assetConfig)
    utils = new ContextUtils(assetConfig, context)
  })

  describe("Arbitrages on various ecosystems", () => {

    swapPathsFixture.forEach((swapPaths: SwapPathsFixture) => {
      ecosystemFactory.getHealthyEcosystems(8).forEach((config: EcosystemConfig) => {
        it(`should fully liquidate an agent in a healthy ecosystem config: "${config.name}" with swap path "${swapPaths}"`, async () => {
          const [swapPath1, swapPath2] = resolveSwapPath(swapPaths)
          const { contracts, signers } = context
          await utils.configureEcosystem(config)
          // perform arbitrage by liquidation
          const { maxLiquidationAmountUBA: maxLiquidatedFAsset } = await contracts.assetManager.getAgentInfo(contracts.agent)
          expect(maxLiquidatedFAsset).to.be.greaterThan(0) // check that agent is in liquidation
          const maxLiquidatedVault = await swapInput(contracts.uniswapV2, swapPath1, maxLiquidatedFAsset)
          const [expectedLiquidationRewardVault, expectedLiquidationRewardPool] = await utils.liquidationOutput(maxLiquidatedFAsset)
          const [,expectedSwappedPool] = await consecutiveSwapOutputs(
            contracts.uniswapV2, [maxLiquidatedVault, expectedLiquidationRewardPool], [swapPath1, swapPath2])
          const { mintedUBA: mintedFAssetBefore } = await contracts.assetManager.getAgentInfo(contracts.agent)
          const agentVaultBalanceBefore = await contracts.vault.balanceOf(contracts.agent)
          const agentPoolBalanceBefore = await contracts.pool.balanceOf(contracts.agent)
          await contracts.liquidator.connect(signers.liquidator).runArbitrage(
            contracts.agent,
            signers.rewardee,
            0, 1, 0, 1,
            ZeroAddress,
            ZeroAddress,
            swapPath1,
            swapPath2
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
          // check that liquidator contract had not had any funds stolen
          const fAssetBalanceLiquidatorContract = await contracts.fAsset.balanceOf(contracts.liquidator)
          expect(fAssetBalanceLiquidatorContract).to.be.approximately(config.initialLiquidatorFAsset, 1)
          const poolBalanceLiquidatorContract = await contracts.pool.balanceOf(contracts.liquidator)
          expect(poolBalanceLiquidatorContract).to.be.approximately(config.initialLiquidatorPool, 1)
          const vaultBalanceLiquidatorContract = await contracts.vault.balanceOf(contracts.liquidator)
          expect(vaultBalanceLiquidatorContract).to.equal(config.initialLiquidatorVault)
        })
      })

      it(`should optimally liquidate less than max f-assets due to low liquidated vault / f-asset dex with swap path "${swapPaths}"`, async () => {
        if (swapPaths[0].length == 3 && swapPaths[1].length == 3) {
          // this doesn't work for a very specific reason:
          // when we swap from vault to f-asset we avoid the low liquiditated vault / f-asset pool
          // but because agent has no vault collateral in this config, liquidator only gets the pool reward
          // this pool reward goes through the low liquidated pool which reduces the profit by more than
          // the liquidation reward. Note that if the first swap goes through the low liquidated pool
          // it raises the price so we can profitably swap pool collateral on that pool back even with low slippage.
          return
        }
        const config = ecosystemFactory.semiHealthyEcosystemWithHighSlippage
        const [swapPath1, swapPath2] = resolveSwapPath(swapPaths)
        const { contracts, signers } = context
        await utils.configureEcosystem(config)
        // calculate full liquidation profit
        const { maxLiquidationAmountUBA: maxLiquidatedFAsset, mintedUBA: mintedFAssetBefore }
          = await contracts.assetManager.getAgentInfo(contracts.agent)
        const maxLiquidatedVault = await swapInput(contracts.uniswapV2, swapPath1, maxLiquidatedFAsset)
        const fullLiquidationProfit = await utils.arbitrageProfit(maxLiquidatedVault, swapPath1, swapPath2)
        // get flash lender vault funds
        const flashLenderVaultBefore = await contracts.vault.balanceOf(contracts.flashLender)
        // perform arbitrage by liquidation
        await contracts.liquidator.connect(signers.liquidator).runArbitrage(
          contracts.agent,
          signers.rewardee,
          0, 1, 0, 1,
          ZeroAddress,
          ZeroAddress,
          swapPath1,
          swapPath2
        )
        const { mintedUBA: mintedFAssetAfter } = await contracts.assetManager.getAgentInfo(contracts.agent)
        const liquidatedFAsset = mintedFAssetBefore - mintedFAssetAfter
        // store test results, so we can graph how close the profit was to the maximum
        storeTestResult(
          { ecosystem: config, assets: assetConfig, paths: swapPaths, liquidatedFAsset },
          `TestResult|${config.name}|${swapPaths[0].join("-")}|${swapPaths[1].join("-")}`
        )
        // check that executed liquidation was at least as profitable as the full one would have been
        const profit = await contracts.vault.balanceOf(signers.rewardee)
        expect(profit).to.be.greaterThanOrEqual(fullLiquidationProfit)
        expect(profit).to.be.greaterThan(0)
        // check that flash lender didn't lose any money
        const flashLenderAfter = await contracts.vault.balanceOf(contracts.flashLender)
        expect(flashLenderAfter).to.equal(flashLenderVaultBefore)
        // check that liquidator contract had not had any funds stolen or given
        const fAssetBalanceLiquidatorContract = await contracts.fAsset.balanceOf(contracts.liquidator)
        expect(fAssetBalanceLiquidatorContract).to.be.approximately(config.initialLiquidatorFAsset, 1)
        const poolBalanceLiquidatorContract = await contracts.pool.balanceOf(contracts.liquidator)
        expect(poolBalanceLiquidatorContract).to.be.approximately(config.initialLiquidatorPool, 1)
        const vaultBalanceLiquidatorContract = await contracts.vault.balanceOf(contracts.liquidator)
        expect(vaultBalanceLiquidatorContract).to.equal(config.initialLiquidatorVault)
      })

      it(`should fail the arbitrage in the case of bad debt on path "${swapPaths}"`, async () => {
        const [swapPath1, swapPath2] = resolveSwapPath(swapPaths)
        const config = ecosystemFactory.unhealthyEcosystemWithBadDebt
        const { contracts, signers } = context
        await utils.configureEcosystem(config)
        await expect(contracts.liquidator.connect(signers.liquidator).runArbitrage(
          contracts.agent,
          signers.rewardee,
          0, 1, 0, 1,
          ZeroAddress,
          ZeroAddress,
          swapPath1,
          swapPath2
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

  })

  describe("Generic arbitrage failures", async () => {

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
      )).to.be.revertedWith("Liquidator: Invalid token path")
      await expect(context.contracts.liquidator.connect(context.signers.liquidator).runArbitrage(
        context.contracts.agent,
        context.signers.rewardee,
        0, 1,
        0, 1,
        ZeroAddress,
        ZeroAddress,
        [context.contracts.vault, context.contracts.pool, context.contracts.fAsset],
        [context.contracts.pool, context.contracts.fAsset]
      )).to.be.revertedWith("Liquidator: Invalid token path")
    })

    it("should fail arbitrage with dexes price falling lower than specified min price", async () => {
      const config = ecosystemFactory.semiHealthyEcosystemWithHighSlippage
      const { contracts, signers } = context
      await utils.configureEcosystem(config)
      // tolerate 10% price slippage (get the price oracle from dex reserves - ideally from last transaction on the last block)
      // for exact percentage we would need to calculate what the optimal swapping amount is going to be
      const [minPriceDex1Mul, minPriceDex1Div] = applySlippageToDexPrice(1000, config.dex1VaultReserve, config.dex1FAssetReserve)
      const [minPriceDex2Mul, minPriceDex2Div] = applySlippageToDexPrice(1000, config.dex2PoolReserve, config.dex2VaultReserve)
      await expect(contracts.liquidator.connect(signers.liquidator).runArbitrage(
        contracts.agent,
        signers.rewardee,
        minPriceDex1Mul,
        minPriceDex1Div,
        minPriceDex2Mul,
        minPriceDex2Div,
        ZeroAddress, ZeroAddress,
        [], []
      )).to.be.revertedWith("UniswapV2: INSUFFICIENT_OUTPUT_AMOUNT")
    })

  })

  describe("Tools", () => {

    it("should correctly calculate min price from max slippage", async () => {
      const config = ecosystemFactory.baseEcosystem
      await utils.configureEcosystem(config)
      const { contracts } = context
      // tolerate 10% price slippage (get the price oracle from dex reserves - ideally from last transaction on the last block)
      const [minPriceDex1Mul, minPriceDex1Div] = applySlippageToDexPrice(1000, config.dex1VaultReserve, config.dex1FAssetReserve)
      const [minPriceDex2Mul, minPriceDex2Div] = applySlippageToDexPrice(1200, config.dex2PoolReserve, config.dex2VaultReserve)
      // get the agent's min prices from contract
      const [_minPriceDex1Mul, _minPriceDex1Div, _minPriceDex2Mul, _minPriceDex2Div]
        = await contracts.liquidator.maxSlippageToMinPrices(1000, 1200, contracts.agent)
      // check that the calculated min prices are the same as the ones from the contract
      expect(minPriceDex1Mul).to.equal(_minPriceDex1Mul)
      expect(minPriceDex1Div).to.equal(_minPriceDex1Div)
      expect(minPriceDex2Mul).to.equal(_minPriceDex2Mul)
      expect(minPriceDex2Div).to.equal(_minPriceDex2Div)
    })

  })

  describe("Security", () => {

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