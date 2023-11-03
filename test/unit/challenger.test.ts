import { expect } from 'chai'
import { setupEcosystem } from './helpers/utils'
import { getContractContext } from './fixtures/context'
import { EcosystemFactory } from './fixtures/ecosystem'
import { balanceDecreasingTxProof } from './fixtures/attestations'
import { XRP, WFLR, ETH } from './fixtures/assets'
import type { AssetConfig, ContractContext } from './fixtures/interface'

// config for used assets
const assetConfig: AssetConfig = {
  asset: XRP,
  vault: ETH,
  pool: WFLR
}
// factory for creating various ecosystems
const ecosystemFactory = new EcosystemFactory(assetConfig)

describe("Tests for Liquidator contract", () => {
  let context: ContractContext

  beforeEach(async function () {
    context = await getContractContext(assetConfig)
  })

  describe("successfull challenges with successfull liquidation", () => {

    it("should do an illegal payment challenge, then liquidate agent", async () => {
      const { challenger, assetManager, vault, agent } = context.contracts
      await setupEcosystem(ecosystemFactory.baseEcosystem, assetConfig, context)
      await challenger.connect(context.challenger).illegalPaymentChallenge(balanceDecreasingTxProof, agent)
      const { status, maxLiquidationAmountUBA } = await assetManager.getAgentInfo(agent)
      expect(status).to.equal(3)
      expect(maxLiquidationAmountUBA).to.equal(0)
      // transfer earnings to challenger calller
      const earnings = await vault.balanceOf(challenger)
      expect(earnings).to.be.greaterThan(0)
      await challenger.connect(context.challenger).withdrawToken(vault)
      const balance = await vault.balanceOf(context.challenger)
      expect(balance).to.equal(earnings)
    })

    it("should do a double payment challenge, then liquidate agent", async () => {
      const { challenger, assetManager, vault, agent } = context.contracts
      await setupEcosystem(ecosystemFactory.baseEcosystem, assetConfig, context)
      await challenger.connect(context.challenger).doublePaymentChallenge(
        balanceDecreasingTxProof, balanceDecreasingTxProof, agent)
      const { status, maxLiquidationAmountUBA } = await assetManager.getAgentInfo(agent)
      expect(status).to.equal(3)
      expect(maxLiquidationAmountUBA).to.equal(0)
      // transfer earnings to challenger caller
      const earnings = await vault.balanceOf(challenger)
      expect(earnings).to.be.greaterThan(0)
      await challenger.connect(context.challenger).withdrawToken(vault)
      const balance = await vault.balanceOf(context.challenger)
      expect(balance).to.equal(earnings)
    })

    it("should do a free balance negative challenge, then liquidate agent", async () => {
      const { challenger, assetManager, vault, agent } = context.contracts
      await setupEcosystem(ecosystemFactory.baseEcosystem, assetConfig, context)
      await challenger.connect(context.challenger).freeBalanceNegativeChallenge([balanceDecreasingTxProof], agent)
      const { status, maxLiquidationAmountUBA } = await assetManager.getAgentInfo(agent)
      expect(status).to.equal(3)
      expect(maxLiquidationAmountUBA).to.equal(0)
      // transfer earnings to challenger caller
      const earnings = await vault.balanceOf(challenger)
      expect(earnings).to.be.greaterThan(0)
      await challenger.connect(context.challenger).withdrawToken(vault)
      const balance = await vault.balanceOf(context.challenger)
      expect(balance).to.equal(earnings)
    })
  })

  describe("successfull challenges with handled unsuccessfull liquidation", () => {

    it("should do an illegal payment challenge, then fail liquidating an agent", async () => {
      const { challenger, assetManager, vault, agent, flashLender } = context.contracts
      await setupEcosystem(ecosystemFactory.baseEcosystem, assetConfig, context)
      await vault.burn(flashLender, await vault.balanceOf(flashLender)) // empty flash lender
      const { status: statusBefore, mintedUBA: mintedBefore, maxLiquidationAmountUBA: maxLiquidationBefore }
        = await assetManager.getAgentInfo(agent)
      expect(statusBefore).to.equal(0)
      expect(maxLiquidationBefore).to.equal(0)
      expect(mintedBefore).to.be.greaterThan(0)
      await challenger.connect(context.challenger).illegalPaymentChallenge(balanceDecreasingTxProof, agent)
      const { status: statusAfter, mintedUBA: mintedAfter, maxLiquidationAmountUBA: maxLiquidationAfter }
        = await assetManager.getAgentInfo(agent)
      expect(statusAfter).to.equal(3)
      expect(maxLiquidationAfter).to.equal(mintedAfter)
    })
  })

})