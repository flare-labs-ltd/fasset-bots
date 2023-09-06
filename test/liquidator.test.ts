import { BN } from 'bn.js'
import { FtsoMockInstance } from '../typechain-truffle/fasset/contracts/fasset/mock/FtsoMock'
import { ERC20MockInstance } from '../typechain-truffle/contracts/mock/ERC20Mock'
import { AssetManagerMockInstance } from '../typechain-truffle/contracts/mock/AssetManagerMock'
import { AgentMockInstance } from '../typechain-truffle/contracts/mock/AgentMock'
import { LiquidatorInstance } from '../typechain-truffle/contracts/Liquidator'
import { LiquidationStrategyMockInstance } from '../typechain-truffle'
import { BlazeSwapRouterInstance } from '../typechain-truffle/blazeswap/contracts/periphery/BlazeSwapRouter'
import { fXRP as fASSET, USDT as VAULT, WNAT as POOL } from './assets'


const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

type BNish = number | string | BN
const toBN = (x: BNish) => new BN(x)

const LiquidationStrategyMock = artifacts.require("LiquidationStrategyMock")
const AssetManagerMock  = artifacts.require("AssetManagerMock")
const FtsoMock = artifacts.require("FtsoMock")
const ERC20Mock = artifacts.require("ERC20Mock")
const AgentMock = artifacts.require("AgentMock")
const BlazeSwapManager = artifacts.require("BlazeSwapManager")
const BlazeSwapFactory = artifacts.require("BlazeSwapBaseFactory")
const BlazeSwap = artifacts.require("BlazeSwapRouter")
const Liquidator = artifacts.require("Liquidator")

contract("Liquidator", function (accounts) {
  let assetManager: AssetManagerMockInstance
  let liquidationStrategy: LiquidationStrategyMockInstance
  let fAsset: {
    token: ERC20MockInstance,
    ftso: FtsoMockInstance
  }
  let vault: {
    token: ERC20MockInstance,
    ftso: FtsoMockInstance
  }
  let pool: {
    token: ERC20MockInstance,
    ftso: FtsoMockInstance
  }
  let agent: AgentMockInstance
  let blazeSwap: BlazeSwapRouterInstance
  let liquidator: LiquidatorInstance

  async function deployBlazeSwap(owner: string): Promise<BlazeSwapRouterInstance> {
    const blazeSwapManager = await BlazeSwapManager.new(owner)
    const blazeSwapFactory = await BlazeSwapFactory.new(blazeSwapManager.address)
    await blazeSwapManager.setFactory(blazeSwapFactory.address)
    return BlazeSwap.new(blazeSwapFactory.address, pool.token.address, false) // pool token is WFLR
  }

  // prices expressed in e.g. usd
  async function setFtsoPrices(
    priceAsset: BNish,
    priceVault: BNish,
    pricePool: BNish
  ): Promise<void> {
    await fAsset.ftso.setCurrentPrice(priceAsset, 0)
    await vault.ftso.setCurrentPrice(priceVault, 0)
    await pool.ftso.setCurrentPrice(pricePool, 0)
  }

  // prices expressed in e.g. usd
  async function setDexFAssetVaultPrice(
    priceAsset: BNish,
    priceVault: BNish,
    reserveVault: BNish
  ): Promise<void> {
    // reserveVault / reserveFAsset = priceVault / priceAsset
    const reserveFAsset = toBN(reserveVault).mul(toBN(priceAsset)).div(toBN(priceVault))
    await fAsset.token.mint(accounts[0], reserveFAsset)
    await vault.token.mint(accounts[0], reserveVault)
    await blazeSwap.addLiquidity(
      fAsset.token.address, vault.token.address, 
      reserveFAsset, reserveVault, 0, 0, 0, 0, 
      ZERO_ADDRESS, MAX_INT
    )
  }

  async function setDexVaultPoolPrice(
    priceVault: BNish,
    pricePool: BNish,
    reservePool: BNish
  ): Promise<void> {
    // reservePool / reserveVault = pricePool / priceVault
    const reserveVault = toBN(reservePool).mul(toBN(priceVault)).div(toBN(pricePool))
    await vault.token.mint(accounts[0], reserveVault)
    await pool.token.mint(accounts[0], reservePool)
    await blazeSwap.addLiquidity(
      vault.token.address, pool.token.address,
      reservePool, reserveVault, 0, 0, 0, 0,
      ZERO_ADDRESS, MAX_INT
    )
  }

  beforeEach(async function () {
    liquidationStrategy = await LiquidationStrategyMock.new()
    await this.liquidationStrategy.setLiquidationFactors(11_000, 11_000) // begin with no pool collateral payout
    fAsset.token = await ERC20Mock.new(fASSET.symbol, fASSET.decimals)
    fAsset.ftso = await FtsoMock.new(fASSET.symbol, 5)
    vault.token = await ERC20Mock.new(VAULT.symbol, VAULT.decimals)
    vault.ftso = await FtsoMock.new(VAULT.symbol, 5)
    pool.token = await ERC20Mock.new(POOL.symbol, VAULT.decimals)
    pool.ftso = await FtsoMock.new(POOL.symbol, 5)
    assetManager = await AssetManagerMock.new(
      liquidationStrategy.address, fASSET.decimals, 
      fASSET.minCollateralRatioBIPS, fASSET.lotSize, 0, 
      vault.ftso.address, pool.ftso.address
    )
    agent = await AgentMock.new(assetManager.address, vault.token.address, pool.token.address)
    blazeSwap = await deployBlazeSwap(accounts[0])
    liquidator = await Liquidator.new()
  })

  it("should make a liquidation", async function () {
    await setFtsoPrices(5_000, 10_000, 133)
    await setDexFAssetVaultPrice(5_000, 10_000, toBN(10).pow(toBN(VAULT.decimals + 1e9)))
    await setDexVaultPoolPrice(10_000, 133, toBN(10).pow(toBN(POOL.decimals + 1e9)))

    const liquidatorObj = await Liquidator.new()
  })

})