import BN from 'bn.js'
import { FakePriceReaderInstance } from '../typechain-truffle/fasset/contracts/fasset/mock/FakePriceReader'
import { ERC20MockInstance } from '../typechain-truffle/contracts/mock/ERC20Mock'
import { AssetManagerMockInstance } from '../typechain-truffle/contracts/mock/AssetManagerMock'
import { AgentMockInstance } from '../typechain-truffle/contracts/mock/AgentMock'
import { BlazeSwapRouterInstance } from '../typechain-truffle/blazeswap/contracts/periphery/BlazeSwapRouter'
import { FlashLenderInstance } from '../typechain-truffle/contracts/FlashLender'
import { LiquidatorInstance } from '../typechain-truffle/contracts/Liquidator'
import { fXRP as fASSET, USDT as VAULT, WNAT as POOL, lotSizeAmg, lotSizeUba, amgSizeUba, roundDownToAmg } from './assets'
import { BNish, toBN, minBN } from './utils/constants'
import { setDexPairPrice, swapOutput, swapInput } from "./utils/blazeswap"
import { assertBnEqual } from './utils/assertBn'


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
  let liquidatorContractOwner = accounts[0]
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
    await priceReader.setPrice(fASSET.symbol, priceAsset)
    await priceReader.setPrice(VAULT.symbol, priceVault)
    await priceReader.setPrice(POOL.symbol, pricePool)
  }

  // mocks asset price increase
  async function setAgentVaultCr(
    assetManager: AssetManagerMockInstance,
    agent: AgentMockInstance,
    crBips: BNish
  ): Promise<void> {
    const agentInfo = await assetManager.getAgentInfo(agent.address)
    const totalMintedUBA = toBN(agentInfo.mintedUBA).add(toBN(agentInfo.redeemingUBA))
    const vaultCollateralWei = toBN(agentInfo.totalVaultCollateralWei)
    // calculate necessary price of asset, expressed in vault collateral
    // P(Vw, Fu) = v / (f Cr)
    // P(Vw, Fu) = P(Vw, S) * P(S, Fu)
    const assetUBAPriceVaultWei = vaultCollateralWei
      .muln(10_000)
      .div(totalMintedUBA)
      .div(toBN(crBips))
    // asset price in USD with f-asset ftso decimals
    const { 0: vaultPriceUSD, 2: vaultFtsoDecimals } = await priceReader.getPrice(VAULT.symbol)
    const { 2: fAssetFtsoDecimals } = await priceReader.getPrice(fASSET.symbol)
    // calculate new ftso price for the asset
    // P(SF, F) = 10^((dF + fV) - (dV + fF)) P(SV, V) P(Vw, Fu)
    const expPlus = vaultFtsoDecimals.addn(fASSET.decimals)
    const expMinus = fAssetFtsoDecimals.addn(VAULT.decimals)
    const assetPriceUSD = vaultPriceUSD
      .mul(assetUBAPriceVaultWei)
      .mul(toBN(10).pow(expPlus))
      .div(toBN(10).pow(expMinus))
    // set new ftso price for the asset
    await priceReader.setPrice(fASSET.symbol, assetPriceUSD)
  }

  async function getAgentCrsBips(agent: AgentMockInstance): Promise<[BN, BN]> {
    const agentInfo = await assetManager.getAgentInfo(agent.address)
    return [
      toBN(agentInfo.vaultCollateralRatioBIPS),
      toBN(agentInfo.poolCollateralRatioBIPS)
    ]
  }

  async function getMaxLiquidatedFAsset(agent: AgentMockInstance): Promise<BN> {
    const agentInfo = await assetManager.getAgentInfo(agent.address)
    return toBN(agentInfo.maxLiquidationAmountUBA)
  }

  async function getMintedFAsset(agent: AgentMockInstance): Promise<BN> {
    const agentInfo = await assetManager.getAgentInfo(agent.address)
    return toBN(agentInfo.mintedUBA)
  }

  function ubaToAmg(uba: BNish): BN {
    return toBN(uba).div(amgSizeUba(fASSET))
  }

  async function liquidationOutput(
    agent: AgentMockInstance,
    amountFAssetUba: BNish
  ): Promise<[BN, BN]> {
    const agentInfo = await assetManager.getAgentInfo(agent.address)
    const amountFAssetAmg = ubaToAmg(amountFAssetUba)
    // for vault
    const amgPriceVault = await calcAmgToTokenWeiPrice(priceReader, vault)
    const amgWithVaultFactor = amountFAssetAmg.mul(toBN(agentInfo.liquidationPaymentFactorVaultBIPS)).divn(10_000)
    const amountVault = amgToTokenWei(amgWithVaultFactor, amgPriceVault)
    // for pool
    const amgPricePool = await calcAmgToTokenWeiPrice(priceReader, pool)
    const amgWithPoolFactor = amountFAssetAmg.mul(toBN(agentInfo.liquidationPaymentFactorPoolBIPS)).divn(10_000)
    const amountPool = amgToTokenWei(amgWithPoolFactor, amgPricePool)
    return [amountVault, amountPool]
  }

  async function calcAmgToTokenWeiPrice(
    priceReader: FakePriceReaderInstance,
    token: ERC20MockInstance,
  ): Promise<BN> {
    const tokenSymbol = await token.symbol()
    const tokenDecimals = await token.decimals()
    const { 0: tokenFtsoPrice, 2: tokenFtsoDecimals } = await priceReader.getPrice(tokenSymbol)
    const { 0: fAssetFtsoPrice, 2: fAssetFtsoDecimals } = await priceReader.getPrice(fASSET.symbol)
    const expPlus = tokenDecimals.add(tokenFtsoDecimals).addn(AMG_TOKEN_WEI_PRICE_SCALE_EXP)
    const expMinus = fAssetFtsoDecimals.addn(fASSET.amgDecimals)
    const scale = toBN(10).pow(expPlus.sub(expMinus))
    return toBN(fAssetFtsoPrice).mul(scale).div(tokenFtsoPrice)
  }

  function amgToTokenWei(
    amgAmount: BNish,
    tokenPrice: BNish,
  ): BN {
    return toBN(amgAmount).mul(toBN(tokenPrice)).div(AMG_TOKEN_WEI_PRICE_SCALE)
  }

  // this is how prices are calculated in the liquidator contract
  async function calcUbaTokenPriceMulDiv(
    priceReader: FakePriceReaderInstance,
    token: ERC20MockInstance,
  ): Promise<[BN, BN]> {
    const tokenSymbol = await token.symbol()
    const tokenDecimals = await token.decimals()
    const { 0: assetPrice, 2: assetFtsoDecimals } = await priceReader.getPrice(fASSET.symbol)
    const { 0: tokenPrice, 2: tokenFtsoDecimals } = await priceReader.getPrice(tokenSymbol)
    return [
        assetPrice.mul(toBN(10).pow(toBN(tokenDecimals).add(tokenFtsoDecimals))),
        tokenPrice.mul(toBN(10).pow(toBN(fASSET.decimals).add(assetFtsoDecimals)))
    ]
}

  beforeEach(async function () {
    // set tokens
    fAsset = await ERC20Mock.new(fASSET.name, fASSET.symbol, fASSET.decimals)
    vault = await ERC20Mock.new(VAULT.name, VAULT.symbol, VAULT.decimals)
    pool = await ERC20Mock.new(POOL.name, POOL.symbol, POOL.decimals)
    // set up price reader
    priceReader = await FakePriceReader.new(accounts[0])
    await priceReader.setDecimals(fASSET.symbol, fASSET.ftsoDecimals)
    await priceReader.setDecimals(VAULT.symbol, VAULT.ftsoDecimals)
    await priceReader.setDecimals(POOL.symbol, POOL.ftsoDecimals)
    // set asset manager
    assetManager = await AssetManagerMock.new(
      pool.address,
      fAsset.address,
      priceReader.address,
      fASSET.minCrBips,
      lotSizeAmg(fASSET),
      fASSET.amgDecimals
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
    liquidator = await Liquidator.new(pool.address, flashLender.address, blazeSwap.address)
  })

  describe("scenarios", () => {

    it("should liquidate an agent with vault cr below min cr", async () => {
      // set ftso and dex prices
      await setFtsoPrices(50_000, 100_000, 1333)
      await setDexPairPrice(blazeSwap, fAsset, vault, 5_000, 10_000, toBN(10).pow(toBN(fASSET.decimals + 15)), accounts[0])
      await setDexPairPrice(blazeSwap, vault, pool, 5_000, 133, toBN(10).pow(toBN(VAULT.decimals + 15)), accounts[0])
      // deposit enough collaterals and mint 40 lots
      await agent.depositVaultCollateral(toBN(10).pow(toBN(VAULT.decimals + 9)))
      await agent.depositPoolCollateral(toBN(10).pow(toBN(POOL.decimals + 11)))
      await agent.mint(minterAccount, lotSizeUba(fASSET).muln(40))
      // price changes drop the vault collateral ratio to 120% below minCr = 150%
      await setAgentVaultCr(assetManager, agent, 12_000)
      const [vaultCrBeforeLiquidation,] = await getAgentCrsBips(agent)
      assert.isTrue(vaultCrBeforeLiquidation.eqn(12_000))
      // perform arbitrage by liquidation
      const maxLiquidatedFAsset = await getMaxLiquidatedFAsset(agent)
      const maxLiquidatedVault = await swapInput(blazeSwap, vault, fAsset, maxLiquidatedFAsset)
      const [expectedLiqVault, expectedLiqPool] = await liquidationOutput(agent, maxLiquidatedFAsset)
      const expectedSwappedPool = await swapOutput(blazeSwap, pool, vault, expectedLiqPool)
      const mintedFAssetBefore = await getMintedFAsset(agent)
      const agentVaultBalanceBefore = await vault.balanceOf(agent.address)
      const agentPoolBalanceBefore = await pool.balanceOf(agent.address)
      await liquidator.runArbitrage(agent.address, { from: liquidatorAccount })
      const fAssetAfter = await getMintedFAsset(agent)
      const agentVaultBalanceAfter = await vault.balanceOf(agent.address)
      const agentPoolBalanceAfter = await pool.balanceOf(agent.address)
      // check that max fAsset was liquidated (this relies on constructed state settings)
      const liquidatedFAsset = mintedFAssetBefore.sub(fAssetAfter)
      assertBnEqual(ubaToAmg(maxLiquidatedFAsset), ubaToAmg(liquidatedFAsset), 1)
      // check that agent's losses were converted into liquidator gained vault collateral
      const crAfterLiquidation = minBN(...await getAgentCrsBips(agent))
      assert.isTrue(crAfterLiquidation.gten(fASSET.minCrBips - 1))
      // check that agent lost appropriate amounts of both collaterals
      const agentVaultLoss = agentVaultBalanceBefore.sub(agentVaultBalanceAfter)
      assertBnEqual(agentVaultLoss, expectedLiqVault)
      const agentPoolLoss = agentPoolBalanceBefore.sub(agentPoolBalanceAfter)
      assertBnEqual(agentPoolLoss, expectedLiqPool)
      // check that redeemer was compensated by agent's lost vault collateral
      const expectedVaultEarnings = expectedLiqVault.add(expectedSwappedPool).sub(maxLiquidatedVault)
      const earnings = await vault.balanceOf(liquidatorAccount)
      assertBnEqual(earnings, expectedVaultEarnings)
      // check that liquidator contract or its owner have no leftover funds
      const fAssetBalanceLiquidatorContract = await fAsset.balanceOf(liquidator.address)
      assertBnEqual(fAssetBalanceLiquidatorContract, 0)
      const fAssetBalanceLiquidatorOwner = await fAsset.balanceOf(liquidatorContractOwner)
      assertBnEqual(fAssetBalanceLiquidatorOwner, 0)
      const poolBalanceLiquidatorContract = await pool.balanceOf(liquidator.address)
      assertBnEqual(poolBalanceLiquidatorContract, 0)
      const poolBalanceLiquidatorOwner = await pool.balanceOf(liquidatorContractOwner)
      assertBnEqual(poolBalanceLiquidatorOwner, 0)
      const vaultBalanceLiquidatorContract = await vault.balanceOf(liquidator.address)
      assertBnEqual(vaultBalanceLiquidatorContract, 0)
      const vaultBalanceLiquidatorOwner = await vault.balanceOf(liquidatorContractOwner)
      assertBnEqual(vaultBalanceLiquidatorOwner, 0)
    })

    it("should liquidate an agent with pool cr below min cr", async () => {

    })
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

})