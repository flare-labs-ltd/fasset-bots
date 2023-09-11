import BN from 'bn.js'
import { FakePriceReaderInstance } from '../typechain-truffle/fasset/contracts/fasset/mock/FakePriceReader'
import { ERC20MockInstance } from '../typechain-truffle/contracts/mock/ERC20Mock'
import { AssetManagerMockInstance } from '../typechain-truffle/contracts/mock/AssetManagerMock'
import { AgentMockInstance } from '../typechain-truffle/contracts/mock/AgentMock'
import { BlazeSwapRouterInstance } from '../typechain-truffle/blazeswap/contracts/periphery/BlazeSwapRouter'
import { FlashLenderInstance } from '../typechain-truffle/contracts/FlashLender'
import { LiquidatorInstance } from '../typechain-truffle/contracts/Liquidator'
import { fXRP as fASSET, USDT as VAULT, WNAT as POOL, lotSizeAmg, lotSizeUba, amgSizeUba, roundDownToAmg } from './assets'
import { ZERO_ADDRESS, MAX_INT, BNish, toBN, minBN } from './helpers/constants'
import { assertBnEqual } from './helpers/assertBn'


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

  // set reserve ratio tokenA : tokenB
  // prices expressed in e.g. usd
  async function setDexPairPrice(
    tokenA: ERC20MockInstance,
    tokenB: ERC20MockInstance,
    priceA: BNish,
    priceB: BNish,
    reserveA: BNish,
  ): Promise<void> {
    // reserveA / reserveB = priceA / priceB
    const reserveB = toBN(reserveA).mul(toBN(priceB)).div(toBN(priceA))
    await tokenA.mint(accounts[0], reserveA)
    await tokenB.mint(accounts[0], reserveB)
    await tokenA.approve(blazeSwap.address, reserveA)
    await tokenB.approve(blazeSwap.address, reserveB)
    await blazeSwap.addLiquidity(
      tokenA.address, tokenB.address,
      reserveA, reserveB, 0, 0, 0, 0,
      ZERO_ADDRESS, MAX_INT
    )
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

  async function swapInput(
    tokenA: ERC20MockInstance,
    tokenB: ERC20MockInstance,
    amountB: BNish
  ): Promise<BN> {
    const { 0: reserveA, 1: reserveB } = await blazeSwap.getReserves(tokenA.address, tokenB.address)
    return toBN(amountB).muln(1000).mul(reserveA).div(reserveB.sub(toBN(amountB))).divn(997)
  }

  // uniswap-v2 formula for swap output
  async function swapOutput(
    tokenA: ERC20MockInstance,
    tokenB: ERC20MockInstance,
    amountA: BNish
  ): Promise<BN> {
    const { 0: reserveA, 1: reserveB } = await blazeSwap.getReserves(tokenA.address, tokenB.address)
    const amountAWithFee = toBN(amountA).muln(997)
    const numerator = amountAWithFee.mul(reserveB)
    const denominator = reserveA.muln(1000).add(amountAWithFee)
    return numerator.div(denominator)
  }

  async function liquidationOutput(
    agent: AgentMockInstance,
    amountFAssetUba: BNish
  ): Promise<[BN, BN]> {
    const agentInfo = await assetManager.getAgentInfo(agent.address)
    const { 0: fAssetPrice } = await priceReader.getPrice(fASSET.symbol)
    const { 0: vaultPrice, 2: vaultFtsoDecimals } = await priceReader.getPrice(VAULT.symbol)
    const { 0: poolPrice, 2: poolFtsoDecimals } = await priceReader.getPrice(POOL.symbol)
    const amountFAssetAmg = ubaToAmg(amountFAssetUba)
    // for vault
    const amgPriceVault  = calcAmgToTokenWeiPrice(VAULT.decimals, vaultPrice, vaultFtsoDecimals, fAssetPrice)
    const amgWithVaultFactor = amountFAssetAmg.mul(toBN(agentInfo.liquidationPaymentFactorVaultBIPS)).divn(10_000)
    const amountVault = amgToTokenWei(amgWithVaultFactor, amgPriceVault)
    // for pool
    const amgPricePool = calcAmgToTokenWeiPrice(POOL.decimals, poolPrice, poolFtsoDecimals, fAssetPrice)
    const amgWithPoolFactor = amountFAssetAmg.mul(toBN(agentInfo.liquidationPaymentFactorPoolBIPS)).divn(10_000)
    const amountPool = amgToTokenWei(amgWithPoolFactor, amgPricePool)
    return [amountVault, amountPool]
  }

  function calcAmgToTokenWeiPrice(
    tokenDecimals: BNish,
    tokenPrice: BNish,
    tokenFtsoDecimals: BNish,
    assetPrice: BNish,
  ): BN {
    const expPlus = Number(tokenDecimals) + Number(tokenFtsoDecimals) + AMG_TOKEN_WEI_PRICE_SCALE_EXP;
    const expMinus = fASSET.amgDecimals + fASSET.ftsoDecimals
    return toBN(assetPrice).mul(toBN(10).pow(toBN(expPlus - expMinus))).div(toBN(tokenPrice))
  }

  function amgToTokenWei(
    amgAmount: BNish,
    tokenPrice: BNish,
  ): BN {
    return toBN(amgAmount).mul(toBN(tokenPrice)).div(AMG_TOKEN_WEI_PRICE_SCALE)
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
    await vault.mint(flashLender.address, toBN(10).pow(toBN(VAULT.decimals + 15)))
    // set liquidator
    liquidator = await Liquidator.new(pool.address, flashLender.address, blazeSwap.address)
  })

  it("should liquidate an agent with vault cr below min cr", async () => {
    // set ftso and dex prices
    await setFtsoPrices(50_000, 100_000, 1333)
    await setDexPairPrice(fAsset, vault, 5_000, 10_000, toBN(10).pow(toBN(fASSET.decimals + 10)))
    await setDexPairPrice(vault, pool, 5_000, 133, toBN(10).pow(toBN(VAULT.decimals + 12)))
    // deposit enough collaterals and mint 40 lots
    await agent.depositVaultCollateral(toBN(10).pow(toBN(VAULT.decimals + 6)))
    await agent.depositPoolCollateral(toBN(10).pow(toBN(POOL.decimals + 8)))
    await agent.mint(minterAccount, lotSizeUba(fASSET).muln(40))
    // price changes drop the vault collateral ratio to 120% below minCr = 150%
    await setAgentVaultCr(assetManager, agent, 12_000)
    const [vaultCrBeforeLiquidation,] = await getAgentCrsBips(agent)
    assert.isTrue(vaultCrBeforeLiquidation.eqn(12_000))

    const mlf = await getMaxLiquidatedFAsset(agent)
    const mlv = await swapInput(vault, fAsset, mlf)
    const mlf2 = await swapOutput(vault, fAsset, mlv)

    // perform arbitrage by liquidation
    const maxLiquidatedFAsset = await getMaxLiquidatedFAsset(agent)
    const maxLiquidatedVault = await swapInput(vault, fAsset, maxLiquidatedFAsset)
    const [expectedLiqVault, expectedLiqPool] = await liquidationOutput(agent, roundDownToAmg(fASSET, mlf2))
    const expectedSwappedPool = await swapOutput(pool, vault, expectedLiqPool)
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
    // check that liquidator contract or its owner have no leftover funds
    /* const fAssetBalanceLiquidatorContract = await fAsset.balanceOf(liquidator.address)
    assertBnEqual(fAssetBalanceLiquidatorContract, 0)
    const fAssetBalanceLiquidatorOwner = await fAsset.balanceOf(liquidatorContractOwner)
    assertBnEqual(fAssetBalanceLiquidatorOwner, 0) */
    const poolBalanceLiquidatorContract = await pool.balanceOf(liquidator.address)
    assertBnEqual(poolBalanceLiquidatorContract, 0)
    const poolBalanceLiquidatorOwner = await pool.balanceOf(liquidatorContractOwner)
    assertBnEqual(poolBalanceLiquidatorOwner, 0)
    const vaultBalanceLiquidatorContract = await vault.balanceOf(liquidator.address)
    assertBnEqual(vaultBalanceLiquidatorContract, 0)
    const vaultBalanceLiquidatorOwner = await vault.balanceOf(liquidatorContractOwner)
    assertBnEqual(vaultBalanceLiquidatorOwner, 0)
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
  })

  it("should liquidate an agent with pool cr below min cr", async () => {

  })

})