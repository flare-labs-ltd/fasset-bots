import { expect } from 'chai'
import { ethers } from 'hardhat'
import { setupEcosystem } from './helpers/utils'
import { getTestContext } from './fixtures/context'
import { EcosystemFactory } from './fixtures/ecosystem'
import { balanceDecreasingTxProof } from './fixtures/attestations'
import { XRP, WFLR, USDT } from './fixtures/assets'
import type { AssetConfig, TestContext } from './fixtures/interface'
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
    challenger.illegalPaymentChallenge(balanceDecreasingTxProof, agent),
  (challenger: Challenger, agent: AgentMock) =>
    challenger.doublePaymentChallenge(balanceDecreasingTxProof, balanceDecreasingTxProof, agent),
  (challenger: Challenger, agent: AgentMock) =>
    challenger.freeBalanceNegativeChallenge([balanceDecreasingTxProof], agent)
]

describe("Tests for Liquidator contract", () => {
  let context: TestContext

  beforeEach(async function () {
    context = await getTestContext(assetConfig)
  })

  describe("making challenges", () => {
    challenges.forEach((challenge) => {
      ecosystems.forEach((ecosystem) => {
        it("should do a successfull challenge, then fail liquidating an agent", async () => {
          const { challenger, assetManager, vault, agent, flashLender } = context.contracts
          await setupEcosystem(ecosystem, assetConfig, context)
          await vault.burn(flashLender, await vault.balanceOf(flashLender)) // empty flash lender
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
          await setupEcosystem(ecosystem, assetConfig, context)
          const { status: statusBefore } = await assetManager.getAgentInfo(agent)
          expect(statusBefore).to.be.lessThan(3)
          await challenge(challenger.connect(context.signers.challenger), agent)
          const { status: statusAfter, maxLiquidationAmountUBA } = await assetManager.getAgentInfo(agent)
          expect(statusAfter).to.equal(3)
          expect(maxLiquidationAmountUBA).to.equal(0)
          // transfer earnings to challenger calller
          const earnings = await vault.balanceOf(challenger)
          expect(earnings).to.be.greaterThan(0)
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

    challenges.forEach((challenge) => {
      it("should not allow calling any of the challenges by non challenger contract owner", async () => {
        const { challenger, agent } = context.contracts
        await expect(challenge(challenger.connect(context.signers.liquidator), agent))
          .to.be.revertedWith("Ownable: caller is not the owner")
      })
    })

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

  })
})