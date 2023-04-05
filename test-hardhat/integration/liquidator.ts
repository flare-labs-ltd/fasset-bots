import { AgentStatus } from "../../src/actors/AgentBot";
import { ORM } from "../../src/config/orm";
import { MockChain } from "../../src/mock/MockChain";
import { checkedCast, toBNExp } from "../../src/utils/helpers";
import { web3 } from "../../src/utils/web3";
import { createTestAssetContext, TestAssetBotContext } from "../test-utils/test-asset-context";
import { testChainInfo } from "../../test/test-utils/TestChainInfo";
import { createAgentBot, createCRAndPerformMintingAndRunSteps, createLiquidator, createMinter, disableMccTraceManager, getAgentStatus } from "../test-utils/helpers";
import { assert } from "chai";
import { TrackedState } from "../../src/state/TrackedState";
import { overrideAndCreateOrm } from "../../src/mikro-orm.config";
import { createTestOrmOptions } from "../../test/test-utils/test-bot-config";
import spies from "chai-spies";
import { expect, spy, use } from "chai";
use(spies);

describe("Liquidator tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let liquidatorAddress: string;
    let chain: MockChain;
    let state: TrackedState;

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
        ownerAddress = accounts[3];
        minterAddress = accounts[4];
        liquidatorAddress = accounts[6];
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.chain, MockChain);
        // chain tunning
        chain.finalizationBlocks = 0;
        chain.secondsPerBlock = 1;
        const lastBlock = await web3.eth.getBlockNumber();
        state = new TrackedState(context, lastBlock);
        await state.initialize();
    });

    it("Should check collateral ratio after price changes", async () => {
        const liquidator = await createLiquidator(liquidatorAddress, state);
        const spyLiquidation = spy.on(liquidator, 'checkAllAgentsForLiquidation');
        // mock price changes
        await context.ftsoManager.mockFinalizePriceEpoch();
        // check collateral ratio after price changes
        await liquidator.runStep();
        expect(spyLiquidation).to.have.been.called.once;
    });
    //TODO
    it.skip("Should liquidate agent when status from normal -> liquidation after price changes", async () => {
        const liquidator = await createLiquidator(liquidatorAddress, state);
        const agentBot = await createAgentBot(context, orm, ownerAddress);
        const minter = await createMinter(context, minterAddress, chain);
        const spyLiquidation = spy.on(agentBot.notifier, 'sendLiquidationStartAlert');
        // create collateral reservation, perform minting and run liquidation trigger
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2, orm, chain);
        await liquidator.runStep();
        // check agent status
        const status1 = await getAgentStatus(agentBot);
        assert.equal(status1, AgentStatus.NORMAL);
        // change prices
        await context.natFtso.setCurrentPrice(36, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // FAsset balance
        const fBalanceBefore = await state.context.fAsset.balanceOf(liquidatorAddress);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await liquidator.runStep();
        // check agent status
        const status3 = await getAgentStatus(agentBot);
        assert.equal(status3, AgentStatus.LIQUIDATION);
        // FAsset balance
        const fBalanceAfter = await state.context.fAsset.balanceOf(liquidatorAddress);
        // send notification
        await agentBot.runStep(orm.em);
        expect(spyLiquidation).to.have.been.called.once;
        // nothing is burned, liquidator does not have FAssets
        expect(fBalanceBefore.eq(fBalanceAfter)).to.be.true;
        expect(fBalanceBefore.eqn(0)).to.be.true;
    });
    //TODO
    it.skip("Should check collateral ratio after minting execution", async () => {
        const liquidator = await createLiquidator(liquidatorAddress, state);
        const agentBot = await createAgentBot(context, orm, ownerAddress);
        const minter = await createMinter(context, minterAddress, chain);
        const spyMinting = spy.on(liquidator, 'handleMintingExecuted');
        // create collateral reservation and perform minting
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2, orm, chain);
        // check collateral ratio after minting execution
        await liquidator.runStep();
        expect(spyMinting).to.have.been.called.once;
    });
    //TODO
    it.skip("Should liquidate agent", async () => {
        const liquidator = await createLiquidator(liquidatorAddress, state);
        const agentBot = await createAgentBot(context, orm, accounts[81]);
        const minter = await createMinter(context, minterAddress, chain);
        await liquidator.runStep();
        // check agent status
        const status1 = await getAgentStatus(agentBot);
        assert.equal(status1, AgentStatus.NORMAL);
        // perform minting
        const lots = 3;
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, lots);
        await agentBot.runStep(orm.em);
        const txHash0 = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        const minted = await minter.executeMinting(crt, txHash0);
        await agentBot.runStep(orm.em);
        // price change
        await context.natFtso.setCurrentPrice(1, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 6), 0);
        // liquidator "buys" f-assets
        await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
        // FAsset and collateral balance
        const fBalanceBefore = await state.context.fAsset.balanceOf(liquidatorAddress);
        const cBalanceBefore = await state.context.wNat.balanceOf(liquidatorAddress);
        // liquidate agent (partially)
        const liquidateMaxUBA = minted.mintedAmountUBA.divn(lots);
        await context.assetManager.liquidate(agentBot.agent.agentVault.address, liquidateMaxUBA, { from: liquidator.address });
        // check agent status
        await agentBot.runStep(orm.em);
        const status2 = await getAgentStatus(agentBot);
        assert.equal(status2, AgentStatus.LIQUIDATION);
        // FAsset and collateral balance
        const fBalanceAfter = await state.context.fAsset.balanceOf(liquidatorAddress);
        const cBalanceAfter = await state.context.wNat.balanceOf(liquidatorAddress);
        // check FAsset balance
        expect((fBalanceBefore.sub(liquidateMaxUBA)).toString()).to.eq(fBalanceAfter.toString());
        expect((cBalanceAfter.gt(cBalanceBefore))).to.be.true;
    });

});