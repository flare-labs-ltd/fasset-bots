import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ContextUtils } from './utils/context'
import { getTestContext } from './fixtures/context'
import { EcosystemFactory } from './fixtures/ecosystem'
import { balanceDecreasingTxProof } from './fixtures/attestations'
import { XRP, WFLR, USDT } from './fixtures/assets'
import type { AssetConfig, TestContext } from './fixtures/interfaces'
import type { Challenger, AgentMock } from '../../types'


// config for used assets
const assetConfig: AssetConfig = {
  asset: XRP,
  vault: USDT,
  pool: WFLR
}
// test with the following ecosystems
const ecosystemFactory = new EcosystemFactory(assetConfig)
const ecosystems = [
  ecosystemFactory.baseEcosystem,
  ecosystemFactory.healthyEcosystemWithVaultUnderwater
]
// three of the possible agent challenges
const challenges = [
  (challenger: Challenger, agent: AgentMock) =>
    challenger.illegalPaymentChallenge(
      balanceDecreasingTxProof, agent,
      0, 1, 0, 1, ethers.ZeroAddress, ethers.ZeroAddress, [], []
    ),
  (challenger: Challenger, agent: AgentMock) =>
    challenger.doublePaymentChallenge(
      balanceDecreasingTxProof, balanceDecreasingTxProof, agent,
      0, 1, 0, 1, ethers.ZeroAddress, ethers.ZeroAddress, [], []
    ),
  (challenger: Challenger, agent: AgentMock) =>
    challenger.freeBalanceNegativeChallenge(
      [balanceDecreasingTxProof], agent,
      0, 1, 0, 1, ethers.ZeroAddress, ethers.ZeroAddress, [], []
    )
]

describe("Tests for the Challenger contract", () => {
  let context: TestContext
  let utils: ContextUtils

  beforeEach(async function () {
    context = await getTestContext(assetConfig)
    utils = new ContextUtils(assetConfig, context)
  })

  describe("making challenges", () => {
    challenges.forEach((challenge) => {
      ecosystems.forEach((ecosystem) => {

        it("should do a successfull challenge, then fail liquidating an agent", async () => {
          const { challenger, assetManager, vault, agent, flashLender } = context.contracts
          await utils.configureEcosystem(ecosystem)
          await vault.burn(flashLender, await vault.balanceOf(flashLender)) // empty flash lender so liquidation fails
          const { status: statusBefore, mintedUBA: mintedBefore } = await assetManager.getAgentInfo(agent)
          expect(statusBefore).to.be.lessThan(3)
          expect(mintedBefore).to.be.greaterThan(0)
          await challenge(challenger.connect(context.signers.challenger), agent)
          const { status: statusAfter, mintedUBA: mintedAfter, maxLiquidationAmountUBA: maxLiquidationAfter }
            = await assetManager.getAgentInfo(agent)
          expect(statusAfter).to.equal(3)
          expect(maxLiquidationAfter).to.equal(mintedAfter)
        })

        it("should successfully challenge otherwise healthy agent, then liquidate", async () => {
          const { challenger, assetManager, vault, agent } = context.contracts
          await utils.configureEcosystem(ecosystem)
          const { status: statusBefore } = await assetManager.getAgentInfo(agent)
          expect(statusBefore).to.be.lessThan(3)
          await challenge(challenger.connect(context.signers.challenger), agent)
          const { status: statusAfter, maxLiquidationAmountUBA, mintedUBA } = await assetManager.getAgentInfo(agent)
          expect(statusAfter).to.equal(3)
          expect(maxLiquidationAmountUBA).to.equal(0)
          expect(mintedUBA).to.equal(0)
          // check that rewards were deposited to the contract
          const earnings = await vault.balanceOf(challenger)
          expect(earnings).to.be.greaterThan(0)
          // withdraw tokens from contract
          await challenger.connect(context.signers.challenger).withdrawToken(vault)
          const balance = await vault.balanceOf(context.signers.challenger)
          expect(balance).to.equal(earnings)
        })

      })
    })
  })

  describe("withdrawal", () => {

    it("should withdraw tokens from contract", async () => {
      const { challenger, vault } = context.contracts
      await vault.mint(challenger, 100)
      await challenger.connect(context.signers.challenger).withdrawToken(vault)
      expect(await vault.balanceOf(context.signers.challenger)).to.equal(100)
    })

    it.skip("should withdraw native tokens from contract", async () => {
      const { challenger } = context.contracts
      await context.signers.deployer.sendTransaction({
        to: await challenger.getAddress(),
        value: ethers.parseEther("1.0")
      })
      const balanceBefore = await ethers.provider.getBalance(challenger)
      await challenger.connect(context.signers.challenger).withderawNat()
      const balanceAfter = await ethers.provider.getBalance(challenger)
      expect(balanceAfter - balanceBefore).to.be.approximately(
        ethers.parseEther("1"), ethers.parseEther("0.0001"))
    })

  })

  describe("security", () => {

    it("should not allow withdrawing tokens by non challenger contract owner", async () => {
      const { challenger, vault } = context.contracts
      await expect(challenger.connect(context.signers.liquidator).withdrawToken(vault))
        .to.be.revertedWith("Ownable: caller is not the owner")
    })

    it("should not allow withdrawing native tokens by non challenger contract owner", async () => {
      const { challenger } = context.contracts
      await expect(challenger.connect(context.signers.liquidator).withderawNat())
        .to.be.revertedWith("Ownable: caller is not the owner")
    })

    it("should not allow running any `runArbitrage` function by non challenger contract owner", async () => {
      await expect(context.contracts.challenger.connect(context.signers.liquidator).runArbitrage(
        ethers.ZeroAddress, ethers.ZeroAddress, 0, 1, 0, 1, ethers.ZeroAddress, ethers.ZeroAddress, [], []
      )).to.be.revertedWith("Challenger: Calling an internal method")
    })
  })
})