// typechain truffle (importing from index doesn't pick up types)
import { FakePriceReaderInstance } from '../../typechain-truffle/fasset/contracts/fasset/mock/FakePriceReader'
import { ERC20MockInstance } from '../../typechain-truffle/contracts/mock/ERC20Mock'
import { AssetManagerMockInstance } from '../../typechain-truffle/contracts/mock/AssetManagerMock'
import { AgentMockInstance } from '../../typechain-truffle/contracts/mock/AgentMock'
import { BlazeSwapRouterInstance } from '../../typechain-truffle/blazeswap/contracts/periphery/BlazeSwapRouter'
import { FlashLenderInstance } from '../../typechain-truffle/contracts/FlashLender'
import { LiquidatorInstance } from '../../typechain-truffle/contracts/Liquidator'
// actual imports
import BN from 'bn.js'
import { expectRevert } from "@openzeppelin/test-helpers"
import { AssetConfig, CollateralAsset, EcosystemConfig, UnderlyingAsset } from './fixtures/interface'
import { lotSizeAmg, ubaToAmg, assertBnEqual, assertBnGreaterOrEqual, toBN, BNish } from './helpers/utils'
import { addLiquidity, swapOutput, swapInput } from "./helpers/contract-utils"
// fixtures
import { XRP, USDT, WFLR } from './fixtures/assets'
import { EcosystemFactory } from './fixtures/ecosystem'


// config for used assets
const assetConfig: AssetConfig = {
  asset: XRP,
  vault: USDT,
  pool: WFLR
}
// factory for creating various ecosystems
const ecosystemFactory = new EcosystemFactory(assetConfig)
// contract constants
const AMG_TOKEN_WEI_PRICE_SCALE_EXP = 9
const AMG_TOKEN_WEI_PRICE_SCALE = toBN(10).pow(toBN(AMG_TOKEN_WEI_PRICE_SCALE_EXP))
// contract factories
const FakePriceReader = artifacts.require("FakePriceReader")
const AssetManagerMock  = artifacts.require("AssetManagerMock")
const ERC20Mock = artifacts.require("ERC20Mock")
const AgentMock = artifacts.require("AgentMock")
const BlazeSwapManager = artifacts.require("BlazeSwapManager")
const BlazeSwapFactory = artifacts.require("BlazeSwapBaseFactory")
const BlazeSwapRouter = artifacts.require("BlazeSwapRouter")
const FlashLender = artifacts.require("FlashLender")
const Liquidator = artifacts.require("Liquidator")

contract("Tests for Liquidator contract", (accounts) => {
  // accounts
  let liquidatorContractOwner = accounts[9]
  let liquidatorAccount = accounts[10]
  let minterAccount = accounts[11]
  // contracts
  let priceReader: FakePriceReaderInstance
  let assetManager: AssetManagerMockInstance
  let fAsset: ERC20MockInstance
  let vault: ERC20MockInstance
  let pool: ERC20MockInstance
  let agent: AgentMockInstance
  let blazeSwap: BlazeSwapRouterInstance
  let flashLender: FlashLenderInstance
  let liquidator: LiquidatorInstance

  // prices expressed in e.g. usd
  async function setFtsoPrices(
    priceAsset: BNish,
    priceVault: BNish,
    pricePool: BNish
  ): Promise<void> {
    await priceReader.setPrice(assetConfig.asset.ftsoSymbol, priceAsset)
    await priceReader.setPrice(assetConfig.vault.ftsoSymbol, priceVault)
    await priceReader.setPrice(assetConfig.pool.ftsoSymbol, pricePool)
  }

  async function liquidationOutput(amountFAssetUba: BNish): Promise<[BN, BN]> {
    const agentInfo = await assetManager.getAgentInfo(agent.address)
    const amountFAssetAmg = ubaToAmg(assetConfig.asset, amountFAssetUba)
    // for vault
    const amgPriceVault = await calcAmgToTokenWeiPrice(assetConfig.vault)
    const amgWithVaultFactor = amountFAssetAmg
      .mul(toBN(agentInfo.liquidationPaymentFactorVaultBIPS))
      .divn(10_000)
    const amountVault = amgToTokenWei(amgWithVaultFactor, amgPriceVault)
    // for pool
    const amgPricePool = await calcAmgToTokenWeiPrice(assetConfig.pool)
    const amgWithPoolFactor = amountFAssetAmg
      .mul(toBN(agentInfo.liquidationPaymentFactorPoolBIPS))
      .divn(10_000)
    const amountPool = amgToTokenWei(amgWithPoolFactor, amgPricePool)
    return [amountVault, amountPool]
  }

  // this is how prices are calculated in the asset manager contract
  async function calcAmgToTokenWeiPrice(collateral: CollateralAsset): Promise<BN> {
    const { 0: collateralFtsoPrice, 2: collateralFtsoDecimals } = await priceReader.getPrice(collateral.ftsoSymbol)
    const { 0: fAssetFtsoPrice, 2: fAssetFtsoDecimals } = await priceReader.getPrice(assetConfig.asset.ftsoSymbol)
    const expPlus = collateralFtsoDecimals.addn(collateral.decimals).addn(AMG_TOKEN_WEI_PRICE_SCALE_EXP)
    const expMinus = fAssetFtsoDecimals.addn(assetConfig.asset.amgDecimals)
    const scale = toBN(10).pow(expPlus.sub(expMinus))
    return toBN(fAssetFtsoPrice).mul(scale).div(collateralFtsoPrice)
  }

  function amgToTokenWei(
    amgAmount: BNish,
    amgPriceTokenWei: BNish,
  ): BN {
    return toBN(amgAmount).mul(toBN(amgPriceTokenWei)).div(AMG_TOKEN_WEI_PRICE_SCALE)
  }

  // this is how prices are calculated in the liquidator contract
  async function calcUbaTokenPriceMulDiv(collateral: CollateralAsset): Promise<[BN, BN]> {
    return calcTokenATokenBPriceMulDiv(assetConfig.asset, collateral)
  }

  async function calcTokenATokenBPriceMulDiv(
    assetA: CollateralAsset | UnderlyingAsset,
    assetB: CollateralAsset | UnderlyingAsset
  ): Promise<[BN, BN]> {
    const { 0: assetAPrice, 2: assetAFtsoDecimals } = await priceReader.getPrice(assetA.ftsoSymbol)
    const { 0: assetBPrice, 2: assetBFtsoDecimals } = await priceReader.getPrice(assetB.ftsoSymbol)
    return [
      assetAPrice.mul(toBN(10).pow(assetBFtsoDecimals.addn(assetB.decimals))),
      assetBPrice.mul(toBN(10).pow(assetAFtsoDecimals.addn(assetA.decimals)))
    ]
  }

  async function arbitrageProfit(liquidatedVault: BNish): Promise<BN> {
    const fAssets = await swapOutput(blazeSwap, vault, fAsset, liquidatedVault)
    const [vaultProfit, poolProfit] = await liquidationOutput(fAssets)
    const poolProfitSwapped = await swapOutput(blazeSwap, pool, vault, poolProfit)
    return vaultProfit.add(poolProfitSwapped).sub(toBN(liquidatedVault))
  }

  async function setupEcosystem(config: EcosystemConfig): Promise<void> {
    // set ftso prices and dex reserves
    await assetManager.setLiquidationFactors(config.liquidationFactorBips, config.liquidationFactorVaultBips)
    await setFtsoPrices(config.assetFtsoPrice, config.vaultFtsoPrice, config.poolFtsoPrice)
    await addLiquidity(blazeSwap, vault, fAsset, config.dex1VaultReserve, config.dex1FAssetReserve, accounts[0])
    await addLiquidity(blazeSwap, pool, vault, config.dex2PoolReserve, config.dex2VaultReserve, accounts[0])
    // deposit collaterals and mint
    await agent.depositVaultCollateral(config.vaultCollateral)
    await agent.depositPoolCollateral(config.poolCollateral)
    await agent.mint(minterAccount, config.mintedUBA)
    // check that agent cr is as expected
    const [vaultCrBeforeLiquidation, poolCrBeforeLiquidation] = await getAgentCrsBips()
    assertBnEqual(vaultCrBeforeLiquidation, config.expectedVaultCrBips, 1)
    assertBnEqual(poolCrBeforeLiquidation, config.expectedPoolCrBips, 1)
  }

  /////////////////////////////////////////////////////////////////////////////////
  // agent getters

  async function getAgentCrsBips(): Promise<[BN, BN]> {
    const agentInfo = await assetManager.getAgentInfo(agent.address)
    return [
      toBN(agentInfo.vaultCollateralRatioBIPS),
      toBN(agentInfo.poolCollateralRatioBIPS)
    ]
  }

  async function getAgentMaxLiquidatedFAsset(): Promise<BN> {
    const agentInfo = await assetManager.getAgentInfo(agent.address)
    return toBN(agentInfo.maxLiquidationAmountUBA)
  }

  async function getMintedFAsset(): Promise<BN> {
    const agentInfo = await assetManager.getAgentInfo(agent.address)
    return toBN(agentInfo.mintedUBA)
  }

  beforeEach(async function () {
    // set mock tokens
    fAsset = await ERC20Mock.new(assetConfig.asset.symbol, assetConfig.asset.symbol, assetConfig.asset.decimals)
    vault = await ERC20Mock.new(assetConfig.vault.name, assetConfig.vault.symbol, assetConfig.vault.decimals)
    pool = await ERC20Mock.new(assetConfig.pool.name, assetConfig.pool.symbol, assetConfig.pool.decimals)
    // set up price reader
    priceReader = await FakePriceReader.new(accounts[0])
    await priceReader.setDecimals(assetConfig.asset.ftsoSymbol, assetConfig.asset.ftsoDecimals)
    await priceReader.setDecimals(assetConfig.vault.ftsoSymbol, assetConfig.vault.ftsoDecimals)
    await priceReader.setDecimals(assetConfig.pool.ftsoSymbol, assetConfig.pool.ftsoDecimals)
    // set asset manager
    assetManager = await AssetManagerMock.new(
      pool.address,
      fAsset.address,
      priceReader.address,
      lotSizeAmg(assetConfig.asset),
      assetConfig.asset.amgDecimals,
      assetConfig.vault.minCollateralRatioBips!,
      assetConfig.pool.minCollateralRatioBips!,
      assetConfig.asset.ftsoSymbol,
      assetConfig.vault.ftsoSymbol,
      assetConfig.pool.ftsoSymbol
    )
    // set agent
    agent = await AgentMock.new(assetManager.address, vault.address)
    // set up blazeswap
    const blazeSwapManager = await BlazeSwapManager.new(accounts[0])
    const blazeSwapFactory = await BlazeSwapFactory.new(blazeSwapManager.address)
    await blazeSwapManager.setFactory(blazeSwapFactory.address)
    blazeSwap = await BlazeSwapRouter.new(blazeSwapFactory.address, pool.address, false)
    // set up flash loans
    flashLender = await FlashLender.new(vault.address)
    await vault.mint(flashLender.address, toBN(10).pow(toBN(assetConfig.vault.decimals + 20)))
    // set liquidator
    liquidator = await Liquidator.new(
      pool.address,
      flashLender.address,
      blazeSwap.address,
      { from: liquidatorContractOwner }
    )
  })

  describe("scenarios with random ecosystems", () => {

    ecosystemFactory.getHealthyEcosystems(10).forEach((config: EcosystemConfig) => {
      it(`should fully liquidate an agent in a healthy ecosystem config: ${config.name}`, async () => {
        // setup ecosystem
        await setupEcosystem(config)
        // perform arbitrage by liquidation
        const maxLiquidatedFAsset = await getAgentMaxLiquidatedFAsset()
        const maxLiquidatedVault = await swapInput(blazeSwap, vault, fAsset, maxLiquidatedFAsset)
        const [expectedLiqVault, expectedLiqPool] = await liquidationOutput(maxLiquidatedFAsset)
        const expectedSwappedPool = await swapOutput(blazeSwap, pool, vault, expectedLiqPool)
        const mintedFAssetBefore = await getMintedFAsset()
        const agentVaultBalanceBefore = await vault.balanceOf(agent.address)
        const agentPoolBalanceBefore = await pool.balanceOf(agent.address)
        await liquidator.runArbitrage(agent.address, { from: liquidatorAccount })
        const mintedFAssetAfter = await getMintedFAsset()
        const agentVaultBalanceAfter = await vault.balanceOf(agent.address)
        const agentPoolBalanceAfter = await pool.balanceOf(agent.address)
        // check that max fAsset was liquidated (this relies on constructed state settings)
        const liquidatedFAsset = mintedFAssetBefore.sub(mintedFAssetAfter)
        assertBnEqual(liquidatedFAsset, maxLiquidatedFAsset)
        // check that both collateral ratios are again above their minimums
        const [crVaultAfterLiq, crPoolAfterLiq] = await getAgentCrsBips()
        assertBnGreaterOrEqual(crVaultAfterLiq, assetConfig.vault.minCollateralRatioBips!)
        assertBnGreaterOrEqual(crPoolAfterLiq, assetConfig.pool.minCollateralRatioBips!)
        // check that agent lost appropriate amounts of both collaterals
        const agentVaultLoss = agentVaultBalanceBefore.sub(agentVaultBalanceAfter)
        assertBnEqual(agentVaultLoss, expectedLiqVault)
        const agentPoolLoss = agentPoolBalanceBefore.sub(agentPoolBalanceAfter)
        assertBnEqual(agentPoolLoss, expectedLiqPool)
        // check that redeemer was compensated by agent's lost vault collateral
        const expectedVaultEarnings = expectedLiqVault.add(expectedSwappedPool).sub(maxLiquidatedVault)
        const earnings = await vault.balanceOf(liquidatorAccount)
        assertBnEqual(earnings, expectedVaultEarnings)
        // check that liquidator contract has no leftover funds
        const fAssetBalanceLiquidatorContract = await fAsset.balanceOf(liquidator.address)
        assertBnEqual(fAssetBalanceLiquidatorContract, 0)
        const poolBalanceLiquidatorContract = await pool.balanceOf(liquidator.address)
        assertBnEqual(poolBalanceLiquidatorContract, 0)
        const vaultBalanceLiquidatorContract = await vault.balanceOf(liquidator.address)
        assertBnEqual(vaultBalanceLiquidatorContract, 0)
      })
    })

    ecosystemFactory.getSemiHealthyEcosystems(1).forEach((config: EcosystemConfig) => {
      it(`should optimally liquidate less than max f-assets due to semi-healthy ecosystem config: ${config.name}`, async () => {
        // setup ecosystem
        await setupEcosystem(config)
        // calculate full liquidation profit
        const maxLiquidatedFAsset = await getAgentMaxLiquidatedFAsset()
        const maxLiquidatedVault = await swapInput(blazeSwap, vault, fAsset, maxLiquidatedFAsset)
        const fullLiquidationProfit = await arbitrageProfit(maxLiquidatedVault)
        // perform arbitrage by liquidation and check that whole arbitrage would fail
        const mintedFAssetBefore = await getMintedFAsset()
        const agentVaultBalanceBefore = await vault.balanceOf(agent.address)
        const agentPoolBalanceBefore = await pool.balanceOf(agent.address)
        await liquidator.runArbitrage(agent.address, { from: liquidatorAccount })
        const mintedFAssetAfter = await getMintedFAsset()
        const agentVaultBalanceAfter = await vault.balanceOf(agent.address)
        const agentPoolBalanceAfter = await pool.balanceOf(agent.address)
        // check that liquidation was not full and that this liquidation was more profitable than the full one
        const liquidatedFAsset = mintedFAssetBefore.sub(mintedFAssetAfter)
        const usedVault = agentVaultBalanceBefore.sub(agentVaultBalanceAfter)
        const usedPool = agentPoolBalanceBefore.sub(agentPoolBalanceAfter)
        const swappedVault = await swapOutput(blazeSwap, vault, fAsset, liquidatedFAsset)
        const profit = swappedVault.add(usedPool).sub(usedVault)
        assertBnGreaterOrEqual(profit, fullLiquidationProfit)
      })
    })

    ecosystemFactory.getUnhealthyEcosystems(1).forEach((config: EcosystemConfig) => {
      it(`should fail at arbitrage liquidation due to unhealthy ecosystem config: ${config.name}`, async () => {
        await setupEcosystem(config)
        const resp = liquidator.runArbitrage(agent.address)
        await expectRevert(resp, "Liquidator: No profitable arbitrage opportunity")
      })
    })
  })

  describe("general liquidation failures", async () => {
    it("should fail liquidation if flash loan can offer 0 fees", async () => {
      await setupEcosystem(ecosystemFactory.healthyEcosystemWithVaultUnderwater)
      await vault.burn(flashLender.address, await vault.balanceOf(flashLender.address))
      const resp = liquidator.runArbitrage(agent.address)
      await expectRevert(resp, "Liquidator: No flash loan available")
    })
  })

  describe("calculation", () => {
    it("should test calculating asset price in pool token in two ways", async () => {
      await setFtsoPrices(50_000, 100_000, 1_333)
      for (let asset of [assetConfig.pool, assetConfig.vault]) {
        const price1 = await calcAmgToTokenWeiPrice(asset)
        const [price2Mul, price2Div] = await calcUbaTokenPriceMulDiv(asset)
        const amountUBA = toBN(1_000_000_000)
        const amountWei1 = amgToTokenWei(ubaToAmg(assetConfig.asset, amountUBA), price1)
        const amountWei2 = amountUBA.mul(price2Mul).div(price2Div)
        assertBnEqual(amountWei1, amountWei2)
      }
    })
  })

  describe("security", () => {

    it("should let only owner collect contract token funds", async () => {
      const amount = toBN(10).pow(toBN(assetConfig.vault.decimals + 3))
      await vault.mint(liquidator.address, amount)
      await expectRevert(liquidator.withdrawToken(vault.address), "Ownable: caller is not the owner")
      await liquidator.withdrawToken(vault.address, { from: liquidatorContractOwner })
      const balance = await vault.balanceOf(liquidatorContractOwner)
      assertBnEqual(balance, amount)
    })

    it("should let only owner collect contract native funds", async () => {
      // don't know how to send money to contract with truffle
    })
  })

})