import { BN } from 'bn.js'
import { FakePriceReaderInstance } from '../typechain-truffle/fasset/contracts/fasset/mock/FakePriceReader'
import { ERC20MockInstance } from '../typechain-truffle/contracts/mock/ERC20Mock'
import { AssetManagerMockInstance } from '../typechain-truffle/contracts/mock/AssetManagerMock'
import { AgentMockInstance } from '../typechain-truffle/contracts/mock/AgentMock'
import { BlazeSwapRouterInstance } from '../typechain-truffle/blazeswap/contracts/periphery/BlazeSwapRouter'
import { FlashLenderInstance } from '../typechain-truffle/contracts/FlashLender'
import { LiquidatorInstance } from '../typechain-truffle/contracts/Liquidator'
import { fXRP as fASSET, USDT as VAULT, WNAT as POOL } from './assets'

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

type BNish = number | string | BN
const toBN = (x: BNish) => new BN(x)
const minBN = (a: BN, b: BN) => a.lt(b) ? a : b

const LOT_SIZE_AMG = toBN(fASSET.lotSize).mul(toBN(10).pow(toBN(fASSET.amgDecimals)))
const LOT_SIZE_UBA = toBN(fASSET.lotSize).mul(toBN(10).pow(toBN(fASSET.decimals)))

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

  // set price of tokenA in tokenB
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
      LOT_SIZE_AMG,
      toBN(10).pow(toBN(fASSET.amgDecimals)),
      fASSET.decimals - fASSET.amgDecimals
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
    await setDexPairPrice(fAsset, vault, 5_000, 10_000, toBN(10).pow(toBN(VAULT.decimals + 10)))
    await setDexPairPrice(vault, pool, 5_000, 133, toBN(10).pow(toBN(POOL.decimals + 12)))
    // deposit enough collaterals and mint 40 lots
    await agent.depositVaultCollateral(toBN(10).pow(toBN(VAULT.decimals + 6)))
    await agent.depositPoolCollateral(toBN(10).pow(toBN(POOL.decimals + 8)))
    await agent.mint(accounts[10], LOT_SIZE_UBA.muln(40))
    // price changes drop the vault collateral ratio to 120% below minCr = 150%
    await setAgentVaultCr(assetManager, agent, 12_000)
    const [vaultCrBeforeLiquidation, poolCrBeforeLiquidation] = await getAgentCrsBips(agent)
    assert.isTrue(vaultCrBeforeLiquidation.eqn(12_000))
    // perform arbitrage by liquidation
    const agentVaultBalanceBefore = await vault.balanceOf(agent.address)
    const agentPoolBalanceBefore = await pool.balanceOf(agent.address)
    await liquidator.runArbitrage(agent.address, { from: accounts[11] })
    const agentVaultBalanceAfter = await vault.balanceOf(agent.address)
    const agentPoolBalanceAfter = await pool.balanceOf(agent.address)
    // check that the new collateral ratio is at minCr
    const crAfterLiquidation = minBN(...await getAgentCrsBips(agent))
    assert.isTrue(crAfterLiquidation.gten(fASSET.minCrBips - 1))
    // check that redeemer was compensated by agent's lost vault collateral
    const earnings = await vault.balanceOf(accounts[11])
    const agentLost = agentVaultBalanceBefore.sub(agentVaultBalanceAfter)
    assert.isTrue(earnings.gte(agentLost))
  })

})