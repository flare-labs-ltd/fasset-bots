import { ethers } from 'hardhat'
import { expect } from 'chai'
import { lotSizeAmg, ubaToAmg, addLiquidity, swapOutput, swapInput } from './helpers/utils'
import { getFactories } from './helpers/factories'
import { XRP, WFLR, ETH } from './fixtures/assets'
import { EcosystemFactory } from './fixtures/ecosystem'
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import type {
  FakePriceReader, ERC20Mock, AssetManagerMock,
  AgentMock, BlazeSwapRouter, FlashLender, Liquidator
} from '../../types'
import type {
  AssetConfig, CollateralAsset,
  UnderlyingAsset, EcosystemConfig
} from './fixtures/interface'


// config for used assets
const assetConfig: AssetConfig = {
  asset: XRP,
  vault: ETH,
  pool: WFLR
}
// factory for creating various ecosystems
const ecosystemFactory = new EcosystemFactory(assetConfig)
// contract constants
const AMG_TOKEN_WEI_PRICE_SCALE_EXP = BigInt(9)
const AMG_TOKEN_WEI_PRICE_SCALE = BigInt(10) ** AMG_TOKEN_WEI_PRICE_SCALE_EXP

describe("Tests for Liquidator contract", () => {
  // accounts
  let accounts: HardhatEthersSigner[]
  let liquidatorContractOwner: HardhatEthersSigner
  let liquidatorAccount: HardhatEthersSigner
  let minterAccount: HardhatEthersSigner
  // contracts
  let priceReader: FakePriceReader
  let assetManager: AssetManagerMock
  let fAsset: ERC20Mock
  let vault: ERC20Mock
  let pool: ERC20Mock
  let agent: AgentMock
  let blazeSwap: BlazeSwapRouter
  let flashLender: FlashLender
  let liquidator: Liquidator

  // prices expressed in e.g. usd
  async function setFtsoPrices(
    priceAsset: bigint,
    priceVault: bigint,
    pricePool: bigint
  ): Promise<void> {
    await priceReader.setPrice(assetConfig.asset.ftsoSymbol, priceAsset)
    await priceReader.setPrice(assetConfig.vault.ftsoSymbol, priceVault)
    await priceReader.setPrice(assetConfig.pool.ftsoSymbol, pricePool)
  }

  async function liquidationOutput(amountFAssetUba: bigint): Promise<[bigint, bigint]> {
    const agentInfo = await assetManager.getAgentInfo(agent)
    const amountFAssetAmg = ubaToAmg(assetConfig.asset, amountFAssetUba)
    // for vault
    const amgPriceVault = await calcAmgToTokenWeiPrice(assetConfig.vault)
    const amgWithVaultFactor = amountFAssetAmg
      * agentInfo.liquidationPaymentFactorVaultBIPS
      / BigInt(10_000)
    const amountVault = amgToTokenWei(amgWithVaultFactor, amgPriceVault)
    // for pool
    const amgPricePool = await calcAmgToTokenWeiPrice(assetConfig.pool)
    const amgWithPoolFactor = amountFAssetAmg
      * agentInfo.liquidationPaymentFactorPoolBIPS
      / BigInt(10_000)
    const amountPool = amgToTokenWei(amgWithPoolFactor, amgPricePool)
    return [amountVault, amountPool]
  }

  // this is how prices are calculated in the asset manager contract
  async function calcAmgToTokenWeiPrice(collateral: CollateralAsset): Promise<bigint> {
    const { 0: collateralFtsoPrice, 2: collateralFtsoDecimals } = await priceReader.getPrice(collateral.ftsoSymbol)
    const { 0: fAssetFtsoPrice, 2: fAssetFtsoDecimals } = await priceReader.getPrice(assetConfig.asset.ftsoSymbol)
    const expPlus = collateralFtsoDecimals + collateral.decimals + AMG_TOKEN_WEI_PRICE_SCALE_EXP
    const expMinus = fAssetFtsoDecimals + assetConfig.asset.amgDecimals
    const scale = BigInt(10) ** (expPlus - expMinus)
    return fAssetFtsoPrice * scale / collateralFtsoPrice
  }

  function amgToTokenWei(
    amgAmount: bigint,
    amgPriceTokenWei: bigint,
  ): bigint {
    return amgAmount * amgPriceTokenWei / AMG_TOKEN_WEI_PRICE_SCALE
  }

  // this is how prices are calculated in the liquidator contract
  async function calcUbaTokenPriceMulDiv(collateral: CollateralAsset): Promise<[bigint, bigint]> {
    return calcTokenATokenBPriceMulDiv(assetConfig.asset, collateral)
  }

  async function calcTokenATokenBPriceMulDiv(
    assetA: CollateralAsset | UnderlyingAsset,
    assetB: CollateralAsset | UnderlyingAsset
  ): Promise<[bigint, bigint]> {
    const { 0: assetAPrice, 2: assetAFtsoDecimals } = await priceReader.getPrice(assetA.ftsoSymbol)
    const { 0: assetBPrice, 2: assetBFtsoDecimals } = await priceReader.getPrice(assetB.ftsoSymbol)
    return [
      assetAPrice * BigInt(10) ** (assetBFtsoDecimals + assetB.decimals),
      assetBPrice * BigInt(10) ** (assetAFtsoDecimals + assetA.decimals)
    ]
  }

  async function arbitrageProfit(liquidatedVault: bigint): Promise<bigint> {
    const fAssets = await swapOutput(blazeSwap, vault, fAsset, liquidatedVault)
    const [vaultProfit, poolProfit] = await liquidationOutput(fAssets)
    const poolProfitSwapped = await swapOutput(blazeSwap, pool, vault, poolProfit)
    return vaultProfit + poolProfitSwapped - liquidatedVault
  }

  async function setupEcosystem(config: EcosystemConfig): Promise<void> {
    // set ftso prices and dex reserves
    await assetManager.setLiquidationFactors(config.liquidationFactorBips, config.liquidationFactorVaultBips)
    await setFtsoPrices(config.assetFtsoPrice, config.vaultFtsoPrice, config.poolFtsoPrice)
    await addLiquidity(blazeSwap, vault, fAsset, config.dex1VaultReserve, config.dex1FAssetReserve, accounts[0].address)
    await addLiquidity(blazeSwap, pool, vault, config.dex2PoolReserve, config.dex2VaultReserve, accounts[0].address)
    // deposit collaterals and mint
    await agent.depositVaultCollateral(config.vaultCollateral)
    await agent.depositPoolCollateral(config.poolCollateral)
    await agent.mint(minterAccount, config.mintedUBA)
    // check that agent cr is as expected
    const {
      vaultCollateralRatioBIPS: vaultCrBeforeLiquidation,
      poolCollateralRatioBIPS: poolCrBeforeLiquidation
    } = await assetManager.getAgentInfo(agent)
    expect(vaultCrBeforeLiquidation).to.be.closeTo(config.expectedVaultCrBips, 1)
    expect(poolCrBeforeLiquidation).to.be.closeTo(config.expectedPoolCrBips, 1)
    // put agent in full liquidation if configured so (this implies agent did an illegal operation)
    if (config.fullLiquidation) await assetManager.putAgentInFullLiquidation(agent)
    const { status: agentStatus } = await assetManager.getAgentInfo(agent)
    expect(agentStatus).to.equal(config.fullLiquidation ? 3 : 0)
  }

  beforeEach(async function () {
    const factories = await getFactories()
    // set accounts
    accounts = await ethers.getSigners()
    liquidatorContractOwner = accounts[9]
    liquidatorAccount = accounts[10]
    minterAccount = accounts[11]
    // set mock tokens
    fAsset = await factories.fAsset.deploy(assetConfig.asset.symbol, assetConfig.asset.symbol, assetConfig.asset.decimals)
    vault = await factories.vault.deploy(assetConfig.vault.name, assetConfig.vault.symbol, assetConfig.vault.decimals)
    pool = await factories.pool.deploy(assetConfig.pool.name, assetConfig.pool.symbol, assetConfig.pool.decimals)
    // set up price reader
    priceReader = await factories.priceReader.deploy(accounts[0])
    await priceReader.setDecimals(assetConfig.asset.ftsoSymbol, assetConfig.asset.ftsoDecimals)
    await priceReader.setDecimals(assetConfig.vault.ftsoSymbol, assetConfig.vault.ftsoDecimals)
    await priceReader.setDecimals(assetConfig.pool.ftsoSymbol, assetConfig.pool.ftsoDecimals)
    // set asset manager
    assetManager = await factories.assetManager.deploy(
      pool,
      fAsset,
      priceReader,
      lotSizeAmg(assetConfig.asset),
      assetConfig.asset.amgDecimals,
      assetConfig.vault.minCollateralRatioBips,
      assetConfig.pool.minCollateralRatioBips,
      assetConfig.asset.ftsoSymbol,
      assetConfig.vault.ftsoSymbol,
      assetConfig.pool.ftsoSymbol
    )
    // set agent
    agent = await factories.agent.deploy(assetManager, vault)
    // set up blazeswap
    const blazeSwapManager = await factories.blazeSwapManager.deploy(accounts[0])
    const blazeSwapFactory = await factories.blazeSwapFactory.deploy(blazeSwapManager)
    await blazeSwapManager.setFactory(blazeSwapFactory)
    blazeSwap = await factories.blazeSwapRouter.deploy(blazeSwapFactory, pool, false)
    // set up flash loans
    flashLender = await factories.flashLender.deploy(vault)
    await vault.mint(flashLender, ethers.MaxUint256 / BigInt(10))
    // set liquidator
    liquidator = await factories.liquidator.connect(liquidatorContractOwner).deploy(pool, flashLender, blazeSwap)
  })

  describe("scenarios with random ecosystems", () => {

    ecosystemFactory.getHealthyEcosystems(10).forEach((config: EcosystemConfig) => {
      it.only(`should fully liquidate an agent in a healthy ecosystem config: ${config.name}`, async () => {
        // setup ecosystem
        await setupEcosystem(config)
        // perform arbitrage by liquidation
        const { maxLiquidationAmountUBA: maxLiquidatedFAsset } = await assetManager.getAgentInfo(agent)
        expect(maxLiquidatedFAsset).to.be.greaterThan(0) // check that agent is in liquidation
        const maxLiquidatedVault = await swapInput(blazeSwap, vault, fAsset, maxLiquidatedFAsset)
        const [expectedLiqVault, expectedLiqPool] = await liquidationOutput(maxLiquidatedFAsset)
        const expectedSwappedPool = await swapOutput(blazeSwap, pool, vault, expectedLiqPool)
        const { mintedUBA: mintedFAssetBefore } = await assetManager.getAgentInfo(agent)
        const agentVaultBalanceBefore = await vault.balanceOf(agent)
        const agentPoolBalanceBefore = await pool.balanceOf(agent)
        await liquidator.connect(liquidatorAccount).runArbitrage(agent)
        const { mintedUBA: mintedFAssetAfter } = await assetManager.getAgentInfo(agent)
        const agentVaultBalanceAfter = await vault.balanceOf(agent)
        const agentPoolBalanceAfter = await pool.balanceOf(agent)
        // check that max fAsset was liquidated (this relies on constructed state settings)
        const liquidatedFAsset = mintedFAssetBefore - mintedFAssetAfter
        expect(liquidatedFAsset).to.equal(maxLiquidatedFAsset)
        // check that both collateral ratios are again above their minimums
        const {
          vaultCollateralRatioBIPS: crVaultAfterLiq,
          poolCollateralRatioBIPS: crPoolAfterLiq
        } = await assetManager.getAgentInfo(agent)
        expect(crVaultAfterLiq).to.be.greaterThanOrEqual(assetConfig.vault.minCollateralRatioBips)
        expect(crPoolAfterLiq).to.be.greaterThanOrEqual(assetConfig.pool.minCollateralRatioBips)
        // check that agent lost appropriate amounts of both collaterals
        const agentVaultLoss = agentVaultBalanceBefore - agentVaultBalanceAfter
        expect(agentVaultLoss).to.equal(expectedLiqVault)
        const agentPoolLoss = agentPoolBalanceBefore - agentPoolBalanceAfter
        expect(agentPoolLoss).to.equal(expectedLiqPool)
        // check that redeemer was compensated by agent's lost vault collateral
        const expectedVaultEarnings = expectedLiqVault + expectedSwappedPool - maxLiquidatedVault
        const earnings = await vault.balanceOf(liquidatorAccount)
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
        // setup ecosystem
        await setupEcosystem(config)
        // calculate full liquidation profit
        const { maxLiquidationAmountUBA: maxLiquidatedFAsset } = await assetManager.getAgentInfo(agent)
        const maxLiquidatedVault = await swapInput(blazeSwap, vault, fAsset, maxLiquidatedFAsset)
        const fullLiquidationProfit = await arbitrageProfit(maxLiquidatedVault)
        // perform arbitrage by liquidation and check that whole arbitrage would fail
        const { mintedUBA: mintedFAssetBefore } = await assetManager.getAgentInfo(agent)
        const agentVaultBalanceBefore = await vault.balanceOf(agent)
        const agentPoolBalanceBefore = await pool.balanceOf(agent)
        await liquidator.connect(liquidatorAccount).runArbitrage(agent)
        const { mintedUBA: mintedFAssetAfter } = await assetManager.getAgentInfo(agent)
        const agentVaultBalanceAfter = await vault.balanceOf(agent)
        const agentPoolBalanceAfter = await pool.balanceOf(agent)
        // check that liquidation was not full and that this liquidation was more profitable than the full one
        const liquidatedFAsset = mintedFAssetBefore - mintedFAssetAfter
        const usedVault = agentVaultBalanceBefore - agentVaultBalanceAfter
        const usedPool = agentPoolBalanceBefore - agentPoolBalanceAfter
        const swappedVault = await swapOutput(blazeSwap, vault, fAsset, liquidatedFAsset)
        const profit = swappedVault + usedPool - usedVault
        expect(profit).to.be.greaterThanOrEqual(fullLiquidationProfit)
      })
    })

    ecosystemFactory.getUnhealthyEcosystems(1).forEach((config: EcosystemConfig) => {
      it(`should fail at arbitrage liquidation due to unhealthy ecosystem config: ${config.name}`, async () => {
        await setupEcosystem(config)
        await expect(liquidator.runArbitrage(agent)).to.be.revertedWith(
          "Liquidator: No profitable arbitrage opportunity")
      })
    })
  })

  describe("general liquidation failures", async () => {
    it("should fail liquidation if flash loan can offer 0 fees", async () => {
      await setupEcosystem(ecosystemFactory.healthyEcosystemWithVaultUnderwater)
      await vault.burn(flashLender, await vault.balanceOf(flashLender))
      await expect(liquidator.runArbitrage(agent)).to.be.revertedWith(
        "Liquidator: No flash loan available")
    })
  })

  describe("calculation", () => {
    it("should test calculating asset price in pool token in two ways", async () => {
      await setFtsoPrices(
        assetConfig.asset.defaultPriceUsd5,
        assetConfig.vault.defaultPriceUsd5,
        assetConfig.pool.defaultPriceUsd5
      )
      for (let asset of [assetConfig.pool, assetConfig.vault]) {
        const price1 = await calcAmgToTokenWeiPrice(asset)
        const [price2Mul, price2Div] = await calcUbaTokenPriceMulDiv(asset)
        const amountUBA = BigInt(1_000_000_000)
        const amountWei1 = amgToTokenWei(ubaToAmg(assetConfig.asset, amountUBA), price1)
        const amountWei2 = amountUBA * price2Mul / price2Div
        expect(amountWei1).to.equal(amountWei2)
      }
    })
  })

  describe("security", () => {

    it("should let only owner collect contract token funds", async () => {
      const amount = BigInt(10) ** (assetConfig.vault.decimals + BigInt(3))
      await vault.mint(liquidator, amount)
      await expect(liquidator.connect(accounts[0]).withdrawToken(vault)).to.be.revertedWith(
        "Ownable: caller is not the owner")
      await liquidator.connect(liquidatorContractOwner).withdrawToken(vault)
      const balance = await vault.balanceOf(liquidatorContractOwner)
      expect(balance).to.equal(amount)
    })

    it("should let only owner collect contract native funds", async () => {
      // don't know how to send money to contract with truffle
    })
  })

})