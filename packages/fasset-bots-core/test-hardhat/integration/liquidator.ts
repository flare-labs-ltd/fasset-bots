import { time } from "@openzeppelin/test-helpers";
import { assert, expect, spy, use } from "chai";
import spies from "chai-spies";
import { ORM } from "../../src/config/orm";
import { AgentStatus } from "../../src/fasset/AssetManagerTypes";
import { MockChain } from "../../src/mock/MockChain";
import { MockTrackedState } from "../../src/mock/MockTrackedState";
import { TrackedState } from "../../src/state/TrackedState";
import { checkedCast, sleep, toBN, toBNExp } from "../../src/utils/helpers";
import { artifacts, web3 } from "../../src/utils/web3";
import { testChainInfo } from "../../test/test-utils/TestChainInfo";
import { createTestOrm } from "../../test/test-utils/create-test-orm";
import { TestAssetBotContext, TestAssetTrackedStateContext, createTestAssetContext, getTestAssetTrackedStateContext } from "../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../test-utils/hardhat-test-helpers";
import { createCRAndPerformMinting, createCRAndPerformMintingAndRunSteps, createTestAgentBot, createTestAgentBotAndMakeAvailable, createTestChallenger, createTestLiquidator, createTestMinter, getAgentStatus } from "../test-utils/helpers";
use(spies);

const IERC20 = artifacts.require("IERC20");

describe("Liquidator tests", () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let trackedStateContext: TestAssetTrackedStateContext;
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let liquidatorAddress: string;
    let challengerAddress: string;
    let chain: MockChain;
    let state: TrackedState;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        ownerAddress = accounts[3];
        minterAddress = accounts[4];
        challengerAddress = accounts[5];
        liquidatorAddress = accounts[6];
    });

    async function initialize() {
        orm = await createTestOrm();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        trackedStateContext = getTestAssetTrackedStateContext(context, true);
        chain = checkedCast(trackedStateContext.blockchainIndexer.chain, MockChain);
        const lastBlock = await web3.eth.getBlockNumber();
        state = new TrackedState(trackedStateContext, lastBlock);
        await state.initialize();
        return { orm, context, trackedStateContext, chain, state };
    }

    beforeEach(async () => {
        ({ orm, context, trackedStateContext, chain, state } = await loadFixtureCopyVars(initialize));
    });

    afterEach(function () {
        spy.restore(console);
    });

    it("Should check collateral ratio after price changes", async () => {
        const liquidator = await createTestLiquidator(trackedStateContext, liquidatorAddress, state);
        const spyLiquidation = spy.on(liquidator, "checkAllAgentsForLiquidation");
        // mock price changes
        await trackedStateContext.ftsoManager.mockFinalizePriceEpoch();
        liquidator.checkedInitialAgents = true;
        // check collateral ratio after price changes
        await liquidator.runStep();
        expect(spyLiquidation).to.have.been.called.once;
    });

    it("Should not liquidate agent when status from normal -> liquidation after price changes (liquidator have no fassets)", async () => {
        const liquidator = await createTestLiquidator(trackedStateContext, liquidatorAddress, state);
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        // create collateral reservation, perform minting and run liquidation trigger
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2000, orm, chain);
        liquidator.checkedInitialAgents = true;
        await liquidator.runStep();
        // check agent status
        const status1 = await getAgentStatus(agentBot);
        assert.equal(status1, AgentStatus.NORMAL);
        // change prices
        await context.assetFtso.setCurrentPrice(toBNExp(10, 7), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(10, 7), 0);
        // FAsset balance
        const fBalanceBefore = await state.context.fAsset.balanceOf(liquidatorAddress);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await liquidator.runStep();
        // check agent status -> did not change as liquidator has not fassets to liquidate
        const status3 = await getAgentStatus(agentBot);
        assert.equal(status3, AgentStatus.NORMAL);
        // FAsset balance
        const fBalanceAfter = await state.context.fAsset.balanceOf(liquidatorAddress);
        // no burned FAssets, liquidator does not have FAssets
        expect(fBalanceBefore.eq(fBalanceAfter)).to.be.true;
        expect(fBalanceBefore.eqn(0)).to.be.true;
    });


    it("Should liquidate agent when status from normal -> liquidation after price changes", async () => {
        const liquidator = await createTestLiquidator(trackedStateContext, liquidatorAddress, state);
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, liquidatorAddress, chain);
        const spyLiquidation = spy.on(agentBot.notifier, "sendLiquidationStartAlert");
        // create collateral reservation, perform minting and run liquidation trigger
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2000, orm, chain);
        liquidator.checkedInitialAgents = true;
        await liquidator.runStep();
        // check agent status
        const status1 = await getAgentStatus(agentBot);
        assert.equal(status1, AgentStatus.NORMAL);
        // change prices
        await context.assetFtso.setCurrentPrice(toBNExp(10, 7), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(10, 7), 0);
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
        // burned FAssets
        expect(fBalanceBefore.gt(fBalanceAfter)).to.be.true;
    });

    it("Should check collateral ratio after minting execution", async () => {
        const liquidator = await createTestLiquidator(trackedStateContext, liquidatorAddress, state);
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        const spyMinting = spy.on(liquidator, "handleMintingExecuted");
        // create collateral reservation and perform minting
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2, orm, chain);
        // check collateral ratio after minting execution
        await liquidator.runStep();
        expect(spyMinting).to.have.been.called.once;
    });

    it("Should liquidate agent", async () => {
        const liquidator = await createTestLiquidator(trackedStateContext, liquidatorAddress, state);
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, accounts[81]);
        // vaultCollateralToken
        const vaultCollateralToken = await IERC20.at((await agentBot.agent.getVaultCollateral()).token);
        const minter = await createTestMinter(context, minterAddress, chain);
        await liquidator.runStep();
        // check agent status
        const status1 = await getAgentStatus(agentBot);
        assert.equal(status1, AgentStatus.NORMAL);
        // perform minting
        const lots = 3000;
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, lots);
        await agentBot.runStep(orm.em);
        const txHash0 = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        const minted = await minter.executeMinting(crt, txHash0);
        await agentBot.runStep(orm.em);
        // price change
        await context.assetFtso.setCurrentPrice(toBNExp(10, 7), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(10, 7), 0);
        // liquidator "buys" f-assets
        await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
        // FAsset and collateral balance
        const fBalanceBefore = await state.context.fAsset.balanceOf(liquidatorAddress);
        const cBalanceBefore = await vaultCollateralToken.balanceOf(liquidatorAddress);
        // liquidate agent (partially)
        const liquidateMaxUBA = minted.mintedAmountUBA.divn(lots);
        await context.assetManager.liquidate(agentBot.agent.agentVault.address, liquidateMaxUBA, { from: liquidator.address });
        // check agent status
        await agentBot.runStep(orm.em);
        const status2 = await getAgentStatus(agentBot);
        assert.equal(status2, AgentStatus.LIQUIDATION);
        // FAsset and collateral balance
        const fBalanceAfter = await state.context.fAsset.balanceOf(liquidatorAddress);
        const cBalanceAfter = await vaultCollateralToken.balanceOf(liquidatorAddress);
        // check FAsset and cr balance
        expect(fBalanceBefore.sub(liquidateMaxUBA).toString()).to.eq(fBalanceAfter.toString());
        expect(cBalanceAfter.gt(cBalanceBefore)).to.be.true;
    });

    it("Should not check collateral ratio after minting execution - faulty function", async () => {
        const lastBlock = await web3.eth.getBlockNumber();
        const mockState = new MockTrackedState(trackedStateContext, lastBlock, state);
        await mockState.initialize();
        const liquidator = await createTestLiquidator(trackedStateContext, liquidatorAddress, mockState);
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        const spyMinting = spy.on(liquidator, "handleMintingExecuted");
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot.agent.vaultAddress, 2, chain);
        // check collateral ratio after minting execution
        await liquidator.runStep();
        expect(spyMinting).to.have.been.called.once;
    });

    it("Should catch full liquidation", async () => {
        const challengerState = new TrackedState(trackedStateContext, await web3.eth.getBlockNumber());
        await challengerState.initialize();
        const challenger = await createTestChallenger(trackedStateContext, challengerAddress, challengerState);
        const liquidator = await createTestLiquidator(trackedStateContext, liquidatorAddress, state);
        const spyLiquidation = spy.on(liquidator, "handleFullLiquidationStarted");
        const spyChlg = spy.on(challenger, "illegalTransactionChallenge");
        // create test actors
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        await challenger.runStep();
        // create collateral reservation and perform minting
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2, orm, chain);
        // perform illegal payment
        const agentInfo = await agentBot.agent.getAgentInfo();
        await agentBot.agent.performPayment(agentInfo.underlyingAddressString, toBN(agentInfo.mintedUBA).divn(2));
        // run challenger's steps until agent's status is FULL_LIQUIDATION
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await sleep(3000);
            await challenger.runStep();
            const agentStatus = await getAgentStatus(agentBot);
            console.log(`Challenger step ${i}, agent status = ${AgentStatus[agentStatus]}`);
            if (agentStatus === AgentStatus.FULL_LIQUIDATION) break;
        }
        // send notification
        await agentBot.runStep(orm.em);
        // check status
        const agentStatus = await getAgentStatus(agentBot);
        assert.equal(agentStatus, AgentStatus.FULL_LIQUIDATION);
        expect(spyChlg).to.have.been.called.once;
        // catch event
        await liquidator.runStep();
        expect(spyLiquidation).to.have.been.called.once;
    });
});
