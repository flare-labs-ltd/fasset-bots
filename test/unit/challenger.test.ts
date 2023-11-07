import { expect } from 'chai'
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

  describe("successfull challenges with successfull liquidation", () => {

    challenges.forEach((challenge) => {
      ecosystems.forEach((ecosystem) => {
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

  describe("successfull challenges with handled unsuccessfull liquidation", () => {

    challenges.forEach((challenge) => {
      ecosystems.forEach((ecosystem) => {
        it("should do an illegal payment challenge, then fail liquidating an agent", async () => {
          const { challenger, assetManager, vault, agent, flashLender } = context.contracts
          await setupEcosystem(ecosystem, assetConfig, context)
          await vault.burn(flashLender, await vault.balanceOf(flashLender)) // empty flash lender
          const { status: statusBefore, mintedUBA: mintedBefore }
            = await assetManager.getAgentInfo(agent)
          expect(statusBefore).to.be.lessThan(3)
          expect(mintedBefore).to.be.greaterThan(0)
          await challenge(challenger.connect(context.signers.challenger), agent)
          const { status: statusAfter, mintedUBA: mintedAfter, maxLiquidationAmountUBA: maxLiquidationAfter }
            = await assetManager.getAgentInfo(agent)
          expect(statusAfter).to.equal(3)
          expect(maxLiquidationAfter).to.equal(mintedAfter)
        })
      })
    })
  })
})