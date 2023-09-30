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
import { EcosystemConfig } from './fixtures/interface'
import { lotSizeAmg, amgSizeUba, assertBnEqual, assertBnGreaterOrEqual, toBN, BNish } from './helpers/utils'
import { addLiquidity, swapOutput, swapInput } from "./helpers/contract-utils"
// fixtures
import { XRP as ASSET, USDT as VAULT, WNAT as POOL } from './fixtures/assets'
import { healthyEcosystemConfigs, unhealthyEcosystemConfigs, semiHealthyEcosystemConfigs } from './fixtures/ecosystem'


const AMG_TOKEN_WEI_PRICE_SCALE_EXP = 9
const AMG_TOKEN_WEI_PRICE_SCALE = toBN(10).pow(toBN(AMG_TOKEN_WEI_PRICE_SCALE_EXP))

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
  let liquidatorContractOwner = accounts[9]
  let liquidatorAccount = accounts[10]
  let minterAccount = accounts[11]

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
    await priceReader.setPrice(ASSET.ftsoSymbol, priceAsset)
    await priceReader.setPrice(VAULT.ftsoSymbol, priceVault)
    await priceReader.setPrice(POOL.ftsoSymbol, pricePool)
  }

  async function liquidationOutput(
    agent: AgentMockInstance,
    amountFAssetUba: BNish
  ): Promise<[BN, BN]> {
    const agentInfo = await assetManager.getAgentInfo(agent.address)
    const amountFAssetAmg = ubaToAmg(amountFAssetUba)
    // for vault
    const amgPriceVault = await calcAmgToTokenWeiPrice(priceReader, vault)
    const amgWithVaultFactor = amountFAssetAmg
      .mul(toBN(agentInfo.liquidationPaymentFactorVaultBIPS))
      .divn(10_000)
    const amountVault = amgToTokenWei(amgWithVaultFactor, amgPriceVault)
    // for pool
    const amgPricePool = await calcAmgToTokenWeiPrice(priceReader, pool)
    const amgWithPoolFactor = amountFAssetAmg
      .mul(toBN(agentInfo.liquidationPaymentFactorPoolBIPS))
      .divn(10_000)
    const amountPool = amgToTokenWei(amgWithPoolFactor, amgPricePool)
    return [amountVault, amountPool]
  }

  async function getAgentCrsBips(agent: AgentMockInstance): Promise<[BN, BN]> {
    const agentInfo = await assetManager.getAgentInfo(agent.address)
    return [
      toBN(agentInfo.vaultCollateralRatioBIPS),
      toBN(agentInfo.poolCollateralRatioBIPS)
    ]
  }

  async function getAgentMaxLiquidatedFAsset(agent: AgentMockInstance): Promise<BN> {
    const agentInfo = await assetManager.getAgentInfo(agent.address)
    return toBN(agentInfo.maxLiquidationAmountUBA)
  }

  async function getMintedFAsset(agent: AgentMockInstance): Promise<BN> {
    const agentInfo = await assetManager.getAgentInfo(agent.address)
    return toBN(agentInfo.mintedUBA)
  }

  function ubaToAmg(uba: BNish): BN {
    return toBN(uba).div(amgSizeUba(ASSET))
  }

  async function calcAmgToTokenWeiPrice(
    priceReader: FakePriceReaderInstance,
    token: ERC20MockInstance,
  ): Promise<BN> {
    const fAssetSymbol = await fAsset.symbol()
    const tokenSymbol = await token.symbol()
    const tokenDecimals = await token.decimals()
    const { 0: tokenFtsoPrice, 2: tokenFtsoDecimals } = await priceReader.getPrice(tokenSymbol)
    const { 0: fAssetFtsoPrice, 2: fAssetFtsoDecimals } = await priceReader.getPrice(fAssetSymbol)
    const expPlus = tokenDecimals.add(tokenFtsoDecimals).addn(AMG_TOKEN_WEI_PRICE_SCALE_EXP)
    const expMinus = fAssetFtsoDecimals.addn(ASSET.amgDecimals)
    const scale = toBN(10).pow(expPlus.sub(expMinus))
    return toBN(fAssetFtsoPrice).mul(scale).div(tokenFtsoPrice)
  }

  function amgToTokenWei(
    amgAmount: BNish,
    amgPriceTokenWei: BNish,
  ): BN {
    return toBN(amgAmount).mul(toBN(amgPriceTokenWei)).div(AMG_TOKEN_WEI_PRICE_SCALE)
  }

  // this is how prices are calculated in the liquidator contract
  async function calcUbaTokenPriceMulDiv(
    priceReader: FakePriceReaderInstance,
    token: ERC20MockInstance
  ): Promise<[BN, BN]> {
    return calcTokenATokenBPriceMulDiv(priceReader, fAsset, token)
  }

  async function calcTokenATokenBPriceMulDiv(
    priceReader: FakePriceReaderInstance,
    tokenA: ERC20MockInstance,
    tokenB: ERC20MockInstance
  ): Promise<[BN, BN]> {
    const tokenASymbol = await tokenA.symbol()
    const tokenBSymbol = await tokenB.symbol()
    const decimalsA = await tokenA.decimals()
    const decimalsB = await tokenB.decimals()
    const { 0: tokenAPrice, 2: tokenAFtsoDecimals } = await priceReader.getPrice(tokenASymbol)
    const { 0: tokenBPrice, 2: tokenBFtsoDecimals } = await priceReader.getPrice(tokenBSymbol)
    return [
      tokenAPrice.mul(toBN(10).pow(decimalsB.add(tokenBFtsoDecimals))),
      tokenBPrice.mul(toBN(10).pow(decimalsA.add(tokenAFtsoDecimals)))
    ]
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
    const [vaultCrBeforeLiquidation, poolCrBeforeLiquidation] = await getAgentCrsBips(agent)
    assertBnEqual(vaultCrBeforeLiquidation, config.expectedVaultCrBips, 1)
    assertBnEqual(poolCrBeforeLiquidation, config.expectedPoolCrBips, 1)
  }

  async function arbitrageProfit(agent: AgentMockInstance, liquidatedVault: BNish): Promise<BN> {
    const fAssets = await swapOutput(blazeSwap, vault, fAsset, liquidatedVault)
    const [vaultProfit, poolProfit] = await liquidationOutput(agent, fAssets)
    const poolProfitSwapped = await swapOutput(blazeSwap, pool, vault, poolProfit)
    return vaultProfit.add(poolProfitSwapped).sub(toBN(liquidatedVault))
  }

  beforeEach(async function () {
    // set tokens
    fAsset = await ERC20Mock.new(ASSET.symbol, ASSET.symbol, ASSET.decimals)
    vault = await ERC20Mock.new(VAULT.name, VAULT.symbol, VAULT.decimals)
    pool = await ERC20Mock.new(POOL.name, POOL.symbol, POOL.decimals)
    // set up price reader
    priceReader = await FakePriceReader.new(accounts[0])
    await priceReader.setDecimals(ASSET.ftsoSymbol, ASSET.ftsoDecimals)
    await priceReader.setDecimals(VAULT.ftsoSymbol, VAULT.ftsoDecimals)
    await priceReader.setDecimals(POOL.ftsoSymbol, POOL.ftsoDecimals)
    // set asset manager
    assetManager = await AssetManagerMock.new(
      pool.address,
      fAsset.address,
      priceReader.address,
      lotSizeAmg(ASSET),
      ASSET.amgDecimals,
      VAULT.minCollateralRatioBips!,
      POOL.minCollateralRatioBips!,
      ASSET.ftsoSymbol,
      VAULT.ftsoSymbol,
      POOL.ftsoSymbol
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
    await vault.mint(flashLender.address, toBN(10).pow(toBN(VAULT.decimals + 20)))
    // set liquidator
    liquidator = await Liquidator.new(pool.address, flashLender.address, blazeSwap.address,
        { from: liquidatorContractOwner })
  })

  describe("scenarios with random ecosystems", () => {

    healthyEcosystemConfigs.forEach((config: EcosystemConfig) => {
      it(`should fully liquidate an agent in a healthy ecosystem config: ${config.name}`, async () => {
        // setup ecosystem
        await setupEcosystem(config)
        // perform arbitrage by liquidation
        const maxLiquidatedFAsset = await getAgentMaxLiquidatedFAsset(agent)
        const maxLiquidatedVault = await swapInput(blazeSwap, vault, fAsset, maxLiquidatedFAsset)
        const [expectedLiqVault, expectedLiqPool] = await liquidationOutput(agent, maxLiquidatedFAsset)
        const expectedSwappedPool = await swapOutput(blazeSwap, pool, vault, expectedLiqPool)
        const mintedFAssetBefore = await getMintedFAsset(agent)
        const agentVaultBalanceBefore = await vault.balanceOf(agent.address)
        const agentPoolBalanceBefore = await pool.balanceOf(agent.address)
        await liquidator.runArbitrage(agent.address, { from: liquidatorAccount })
        const mintedFAssetAfter = await getMintedFAsset(agent)
        const agentVaultBalanceAfter = await vault.balanceOf(agent.address)
        const agentPoolBalanceAfter = await pool.balanceOf(agent.address)
        // check that max fAsset was liquidated (this relies on constructed state settings)
        const liquidatedFAsset = mintedFAssetBefore.sub(mintedFAssetAfter)
        assertBnEqual(liquidatedFAsset, maxLiquidatedFAsset)
        // check that both collateral ratios are again above their minimums
        const [crVaultAfterLiq, crPoolAfterLiq] = await getAgentCrsBips(agent)
        assertBnGreaterOrEqual(crVaultAfterLiq, VAULT.minCollateralRatioBips!)
        assertBnGreaterOrEqual(crPoolAfterLiq, POOL.minCollateralRatioBips!)
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

    semiHealthyEcosystemConfigs.forEach((config: EcosystemConfig) => {
      it("should optimally liquidate an agent with pool cr below min cr", async () => {
        // setup ecosystem
        await setupEcosystem(config)
        // calculate full liquidation profit
        const maxLiquidatedFAsset = await getAgentMaxLiquidatedFAsset(agent)
        const maxLiquidatedVault = await swapInput(blazeSwap, vault, fAsset, maxLiquidatedFAsset)
        const fullLiquidationProfit = await arbitrageProfit(agent, maxLiquidatedVault)
        // perform arbitrage by liquidation and check that whole arbitrage would fail
        const mintedFAssetBefore = await getMintedFAsset(agent)
        const agentVaultBalanceBefore = await vault.balanceOf(agent.address)
        const agentPoolBalanceBefore = await pool.balanceOf(agent.address)
        await liquidator.runArbitrage(agent.address, { from: liquidatorAccount })
        const mintedFAssetAfter = await getMintedFAsset(agent)
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

    unhealthyEcosystemConfigs.forEach((config: EcosystemConfig) => {
      it(`should fail at arbitrage liquidation due to reason: ${config.name}`, async () => {
        await setupEcosystem(config)
        const resp = liquidator.runArbitrage(agent.address)
        await expectRevert(resp, "Liquidator: No profitable arbitrage opportunity")
      })
    })
  })

  describe("general liquidation failures", async () => {
    it("should fail liquidation if flash loan can offer 0 fees", async () => {
      await setupEcosystem(healthyEcosystemConfigs[0])
      await vault.burn(flashLender.address, await vault.balanceOf(flashLender.address))
      const resp = liquidator.runArbitrage(agent.address)
      await expectRevert(resp, "Liquidator: No flash loan available")
    })
  })

  describe("calculation", () => {
    it("should test calculating asset price in pool token in two ways", async () => {
      await setFtsoPrices(50_000, 100_000, 1_333)
      for (let token of [pool, vault]) {
        const price1 = await calcAmgToTokenWeiPrice(priceReader, token)
        const [price2Mul, price2Div] = await calcUbaTokenPriceMulDiv(priceReader, token)
        const amountUBA = toBN(1_000_000_000)
        const amountWei1 = amgToTokenWei(ubaToAmg(amountUBA), price1)
        const amountWei2 = amountUBA.mul(price2Mul).div(price2Div)
        assertBnEqual(amountWei1, amountWei2)
      }
    })
  })

  describe("security", () => {

    it("should let only owner collect contract token funds", async () => {
      const amount = toBN(10).pow(toBN(VAULT.decimals + 3))
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