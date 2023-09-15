// typechain truffle (importing from index doesn't sense types)
import { FakePriceReaderInstance } from '../typechain-truffle/fasset/contracts/fasset/mock/FakePriceReader'
import { ERC20MockInstance } from '../typechain-truffle/contracts/mock/ERC20Mock'
import { AssetManagerMockInstance } from '../typechain-truffle/contracts/mock/AssetManagerMock'
import { AgentMockInstance } from '../typechain-truffle/contracts/mock/AgentMock'
import { BlazeSwapRouterInstance } from '../typechain-truffle/blazeswap/contracts/periphery/BlazeSwapRouter'
import { FlashLenderInstance } from '../typechain-truffle/contracts/FlashLender'
import { LiquidatorInstance } from '../typechain-truffle/contracts/Liquidator'
// actual imports
import BN from 'bn.js'
import { EcosystemConfig } from './helpers/interface'
import { addLiquidity, swapOutput, swapInput, lotSizeAmg, amgSizeUba, assertBnEqual, minBN, toBN, BNish, expBN } from "./helpers/utils"
import { XRP as ASSET, USDT as VAULT, WNAT as POOL } from './helpers/assets'
import { healthyEcosystemConfigs } from './helpers/scenarios'


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
    const fAssetSymbol = await fAsset.symbol()
    await priceReader.setPrice(fAssetSymbol, priceAsset)
    await priceReader.setPrice(VAULT.symbol, priceVault)
    await priceReader.setPrice(POOL.symbol, pricePool)
  }

  // mocks asset price increase
  async function setAgentCr(
    assetManager: AssetManagerMockInstance,
    agent: AgentMockInstance,
    crBips: BNish,
    vaultCr: boolean = true
  ): Promise<void> {
    const COLLATERAL = (vaultCr) ? VAULT : POOL
    const agentInfo = await assetManager.getAgentInfo(agent.address)
    const totalMintedUBA = toBN(agentInfo.mintedUBA).add(toBN(agentInfo.redeemingUBA))
    const collateralWei = toBN((vaultCr)
      ? agentInfo.totalVaultCollateralWei
      : agentInfo.totalPoolCollateralNATWei
    )
    // calculate necessary price of asset, expressed in collateral wei
    // P(Vw, Fu) = v / (f Cr)
    // P(Vw, Fu) = P(Vw, S) * P(S, Fu)
    const assetUBAPriceCollateralWei = collateralWei
      .muln(10_000)
      .div(totalMintedUBA)
      .div(toBN(crBips))
    // asset price in USD with f-asset ftso decimals
    const { 0: collateralFtsoPrice, 2: collateralFtsoDecimals } = await priceReader.getPrice(COLLATERAL.symbol)
    const { 2: fAssetFtsoDecimals } = await priceReader.getPrice(await fAsset.symbol())
    // calculate new ftso price for the asset
    // P(SF, F) = 10^((dF + fV) - (dV + fF)) P(SV, V) P(Vw, Fu)
    const expPlus = collateralFtsoDecimals.add(await fAsset.decimals())
    const expMinus = fAssetFtsoDecimals.addn(COLLATERAL.decimals)
    const assetFtsoPrice = collateralFtsoPrice
      .mul(assetUBAPriceCollateralWei)
      .mul(toBN(10).pow(expPlus))
      .div(toBN(10).pow(expMinus))
    // set new ftso price for the asset
    await priceReader.setPrice(await fAsset.symbol(), assetFtsoPrice)
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
    token: ERC20MockInstance,
  ): Promise<[BN, BN]> {
    const fAssetSymbol = await fAsset.symbol()
    const fAssetDecimals = await fAsset.decimals()
    const tokenSymbol = await token.symbol()
    const tokenDecimals = await token.decimals()
    const { 0: assetPrice, 2: assetFtsoDecimals } = await priceReader.getPrice(fAssetSymbol)
    const { 0: tokenPrice, 2: tokenFtsoDecimals } = await priceReader.getPrice(tokenSymbol)
    return [
      assetPrice.mul(toBN(10).pow(tokenDecimals.add(tokenFtsoDecimals))),
      tokenPrice.mul(toBN(10).pow(fAssetDecimals.add(assetFtsoDecimals)))
    ]
}

  beforeEach(async function () {
    const fAssetSymbol = "f" + ASSET.symbol
    // set tokens
    fAsset = await ERC20Mock.new(fAssetSymbol, fAssetSymbol, ASSET.decimals)
    vault = await ERC20Mock.new(VAULT.name, VAULT.symbol, VAULT.decimals)
    pool = await ERC20Mock.new(POOL.name, POOL.symbol, POOL.decimals)
    // set up price reader
    priceReader = await FakePriceReader.new(accounts[0])
    await priceReader.setDecimals(fAssetSymbol, ASSET.ftsoDecimals)
    await priceReader.setDecimals(VAULT.symbol, VAULT.ftsoDecimals)
    await priceReader.setDecimals(POOL.symbol, POOL.ftsoDecimals)
    // set asset manager
    assetManager = await AssetManagerMock.new(
      pool.address,
      fAsset.address,
      priceReader.address,
      ASSET.minCrBips,
      lotSizeAmg(ASSET),
      ASSET.amgDecimals
    )
    await assetManager.setLiquidationFactors(12_000, 10_000)
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
      it(`should fully liquidate an agent in a healthy ecosystem with ${config.name}`, async () => {
        // set ftso prices and dex reserves
        await setFtsoPrices(config.ftsoAssetPrice, config.ftsoVaultPrice, config.ftsoPoolPrice)
        await addLiquidity(blazeSwap, vault, fAsset, config.dex1VaultReserve, config.dex1FAssetReserve, accounts[0])
        await addLiquidity(blazeSwap, pool, vault, config.dex2PoolReserve, config.dex2VaultReserve, accounts[0])
        // deposit enough collaterals and mint
        await agent.depositVaultCollateral(config.vaultCollateral)
        await agent.depositPoolCollateral(config.poolCollateral)
        await agent.mint(minterAccount, config.mintedUBA)
        // asset price changes drop the vault collateral ratio to 120% below minCr = 150%
        const [vaultCrBeforeLiquidation, poolCrBeforeLiquidation] = await getAgentCrsBips(agent)
        assertBnEqual(vaultCrBeforeLiquidation, config.expectedVaultCr)
        assertBnEqual(poolCrBeforeLiquidation, config.expectedPoolCr)
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
        assertBnEqual(maxLiquidatedFAsset, liquidatedFAsset)
        // check that agent's losses were converted into liquidator gained vault collateral
        const crAfterLiquidation = minBN(...await getAgentCrsBips(agent))
        assert.isTrue(crAfterLiquidation.gten(ASSET.minCrBips))
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

    /* unhealthyEcosystemConfigs.forEach((config: EcosystemConfig) => {
      it("should optimally liquidate an agent with pool cr below min cr", async () => {
        // set ftso prices
        await setFtsoPrices(config.ftsoAssetPrice, config.ftsoVaultPrice, config.ftsoPoolPrice)
        // set vault dex liquidity such that it is barely enough for liquidation
        await setDexPairPrice(blazeSwap, vault, fAsset, config.dex1VaultPrice, config.dex1FAssetPrice, expBN(18), accounts[0])
        await setDexPairPrice(blazeSwap, pool, vault, config.dex2PoolPrice, config.dex2VaultPrice, config.dex2PoolLiquidity, accounts[0])
        // deposit enough collaterals and mint
        await agent.depositVaultCollateral(config.agentVaultCollateral)
        await agent.depositPoolCollateral(config.agentPoolCollateral)
        await agent.mint(minterAccount, config.agentMintedUBA)
        // asset price changes drop the vault collateral ratio to 120% below minCr = 150%
        await setAgentCr(assetManager, agent, 13_000, config.modifyVaultCr!)
        const crBeforeLiquidation = await getAgentCrsBips(agent)
        assert.isTrue(crBeforeLiquidation[Number(!config.modifyVaultCr!)].eqn(13_000))
        // perform arbitrage by liquidation
        const { 1: fAssetReserveBefore } = await blazeSwap.getReserves(vault.address, fAsset.address)
        console.log("fasset reserve before", fAssetReserveBefore.toString())

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
        console.log("agent vault collateral", config.agentVaultCollateral.toString())
        console.log("max liquidated fassets", maxLiquidatedFAsset.toString())
        console.log("liquidated fassets", mintedFAssetBefore.sub(mintedFAssetAfter).toString())
        const { 1: fAssetReserveAfter } = await blazeSwap.getReserves(vault.address, fAsset.address)
        console.log("fasset reserve after", fAssetReserveAfter.toString())
        console.log("start dex vault liq", config.agentVaultCollateral.toString())
      })
    }) */
  })


  describe("calculation", () => {
    it("should test calculating asset price in pool token in two ways", async () => {
      await setFtsoPrices(50_000, 100_000, 1333)
      const token = pool
      const price1 = await calcAmgToTokenWeiPrice(priceReader, token)
      const [price2Mul, price2Div] = await calcUbaTokenPriceMulDiv(priceReader, token)
      const amountUBA = toBN(10_000_000)
      const amountWei1 = amgToTokenWei(ubaToAmg(amountUBA), price1)
      const amountWei2 = amountUBA.mul(price2Mul).div(price2Div)
      assertBnEqual(amountWei1, amountWei2)
    })
  })

  describe("security", () => {

    it("should let only owner collect contract token funds", async () => {
      const amount = toBN(10).pow(toBN(VAULT.decimals + 3))
      await vault.mint(liquidator.address, amount)
      await liquidator.withdrawToken(vault.address, { from: liquidatorContractOwner })
      const resp = liquidator.withdrawToken(vault.address)

      const balance = await vault.balanceOf(liquidatorContractOwner)
      assertBnEqual(balance, amount)
    })

    it("should let only owner collect contract native funds", async () => {
      // don't know how to send money to contract with truffle
    })
  })

})