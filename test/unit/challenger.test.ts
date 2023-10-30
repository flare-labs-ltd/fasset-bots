import { ethers } from 'hardhat'
import { expect } from 'chai'
import { lotSizeAmg, addLiquidity } from './helpers/utils'
import { getFactories } from './helpers/factories'
import { XRP, WFLR, ETH } from './fixtures/assets'
import { EcosystemFactory } from './fixtures/ecosystem'
import { balanceDecreasingTxProof } from './fixtures/attestations'
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import type {
  FakePriceReader, ERC20Mock, AssetManagerMock,
  AgentMock, BlazeSwapRouter, FlashLender, Challenger
} from '../../types'
import type { AssetConfig, EcosystemConfig } from './fixtures/interface'

// config for used assets
const assetConfig: AssetConfig = {
  asset: XRP,
  vault: ETH,
  pool: WFLR
}
// factory for creating various ecosystems
const ecosystemFactory = new EcosystemFactory(assetConfig)

describe("Tests for Liquidator contract", () => {
  // accounts
  let accounts: HardhatEthersSigner[]
  let challengerAccount: HardhatEthersSigner
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
  let challenger: Challenger

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
    challengerAccount = accounts[10]
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
    challenger = await factories.challenger.connect(challengerAccount).deploy(flashLender, blazeSwap)
  })

  describe("successfull challenges with successfull liquidation", () => {

    it("should do an illegal payment challenge, then liquidate agent", async () => {
      await setupEcosystem(ecosystemFactory.baseEcosystem)
      await challenger.connect(challengerAccount).illegalPaymentChallenge(balanceDecreasingTxProof, agent)
      const { status, maxLiquidationAmountUBA } = await assetManager.getAgentInfo(agent)
      expect(status).to.equal(3)
      expect(maxLiquidationAmountUBA).to.equal(0)
    })

    it("should do a double payment challenge, then liquidate agent", async () => {
      await setupEcosystem(ecosystemFactory.baseEcosystem)
      await challenger.connect(challengerAccount).doublePaymentChallenge(
        balanceDecreasingTxProof, balanceDecreasingTxProof, agent)
      const { status, maxLiquidationAmountUBA } = await assetManager.getAgentInfo(agent)
      expect(status).to.equal(3)
      expect(maxLiquidationAmountUBA).to.equal(0)
    })

    it("should do a free balance negative challenge, then liquidate agent", async () => {
      await setupEcosystem(ecosystemFactory.baseEcosystem)
      await challenger.connect(challengerAccount).freeBalanceNegativeChallenge([balanceDecreasingTxProof], agent)
      const { status, maxLiquidationAmountUBA } = await assetManager.getAgentInfo(agent)
      expect(status).to.equal(3)
      expect(maxLiquidationAmountUBA).to.equal(0)
    })
  })

  describe("successfull challenges with handled unsuccessfull liquidation", () => {

    it("should do an illegal payment challenge, then fail liquidating an agent", async () => {
      await setupEcosystem(ecosystemFactory.baseEcosystem)
      await vault.burn(flashLender, await vault.balanceOf(flashLender)) // empty flash lender
      const {
        status: statusBefore,
        mintedUBA: mintedUbaBefore,
        maxLiquidationAmountUBA: maxLiquidationBefore
      } = await assetManager.getAgentInfo(agent)
      expect(statusBefore).to.equal(0)
      expect(maxLiquidationBefore).to.equal(0)
      expect(mintedUbaBefore).to.be.greaterThan(0)
      await challenger.connect(challengerAccount).illegalPaymentChallenge(balanceDecreasingTxProof, agent)
      const {
        status: statusAfter,
        mintedUBA: mintedUbaAfter,
        maxLiquidationAmountUBA: maxLiquidationAfter
      } = await assetManager.getAgentInfo(agent)
      expect(statusAfter).to.equal(3)
      expect(maxLiquidationAfter).to.equal(mintedUbaAfter)
    })
  })

})