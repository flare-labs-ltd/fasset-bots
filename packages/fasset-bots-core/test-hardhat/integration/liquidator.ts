import BN from "bn.js";
import { time } from "@openzeppelin/test-helpers";
import { assert, expect, spy, use } from "chai";
import spies from "chai-spies";
import { ORM } from "../../src/config/orm";
import { AgentStatus, CollateralClass } from "../../src/fasset/AssetManagerTypes";
import { MockChain } from "../../src/mock/MockChain";
import { TrackedState } from "../../src/state/TrackedState";
import { DAYS, MAX_BIPS, checkedCast, sleep, toBN, toBNExp } from "../../src/utils/helpers";
import { artifacts, web3 } from "../../src/utils/web3";
import { testChainInfo } from "../../test/test-utils/TestChainInfo";
import { createTestOrm } from "../../test/test-utils/create-test-orm";
import { TestAssetBotContext, TestAssetTrackedStateContext, createTestAssetContext, getTestAssetTrackedStateContext } from "../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../test-utils/hardhat-test-helpers";
import { createCRAndPerformMintingAndRunSteps, createTestAgentBotAndMakeAvailable, createTestChallenger, createTestLiquidator, createTestMinter, getAgentStatus } from "../test-utils/helpers";
import { assetPriceForAgentCr } from "../test-utils/calculations";
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

    // it("Should check collateral ratio after price changes", async () => {
    //     const liquidator = await createTestLiquidator(trackedStateContext, liquidatorAddress, state);
    //     const spyLiquidation = spy.on(liquidator, "checkAllAgentsForLiquidation");
    //     // mock price changes
    //     await trackedStateContext.ftsoManager.mockFinalizePriceEpoch();
    //     // check collateral ratio after price changes
    //     await liquidator.runStep();
    //     expect(spyLiquidation).to.have.been.called.once;
    // });

    it("Should not liquidate agent when status from normal -> liquidation after price changes (liquidator have no fassets)", async () => {
        const liquidator = await createTestLiquidator(trackedStateContext, liquidatorAddress, state);
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        // create collateral reservation, perform minting and run liquidation trigger
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2000, orm, chain);
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

    it("Should partially liquidate agent", async () => {
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

    it("Should liquidate agent due to price change", async () => {
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
        await context.assetFtso.setCurrentPrice(toBNExp(2, 6), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(2, 6), 0);
        await context.ftsoManager.mockFinalizePriceEpoch();
        // liquidator "buys" f-assets
        const poolFees = await agentBot.agent.poolFeeBalance();
        await agentBot.agent.withdrawPoolFees(poolFees, liquidator.address);
        await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
        // FAsset and collateral balance
        const fBalanceBefore = await state.context.fAsset.balanceOf(liquidatorAddress);
        const cBalanceBefore = await vaultCollateralToken.balanceOf(liquidatorAddress);
        // liquidate agent
        await liquidator.runStep();
        // check agent status
        await agentBot.runStep(orm.em);
        // FAsset and collateral balance
        const fBalanceAfter = await state.context.fAsset.balanceOf(liquidatorAddress);
        const cBalanceAfter = await vaultCollateralToken.balanceOf(liquidatorAddress);
        // check FAsset and cr balance
        expect(fBalanceAfter.lt(fBalanceBefore.divn(4))).to.be.true;
        expect(cBalanceAfter.gt(cBalanceBefore)).to.be.true;
    });

    it("Should liquidate agent due to price change - liquidate everything", async () => {
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
        await context.assetFtso.setCurrentPrice(toBNExp(10, 6), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(10, 6), 0);
        await context.ftsoManager.mockFinalizePriceEpoch();
        // liquidator "buys" f-assets
        const poolFees = await agentBot.agent.poolFeeBalance();
        await agentBot.agent.withdrawPoolFees(poolFees, liquidator.address);
        await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
        // FAsset and collateral balance
        const fBalanceBefore = await state.context.fAsset.balanceOf(liquidatorAddress);
        const cBalanceBefore = await vaultCollateralToken.balanceOf(liquidatorAddress);
        // liquidate agent
        await liquidator.runStep();
        // check agent status
        await agentBot.runStep(orm.em);
        // FAsset and collateral balance
        const fBalanceAfter = await state.context.fAsset.balanceOf(liquidatorAddress);
        const cBalanceAfter = await vaultCollateralToken.balanceOf(liquidatorAddress);
        // check FAsset and cr balance
        const info = await agentBot.agent.getAgentInfo();
        expect(String(info.mintedUBA)).eq("0");
        expect(String(fBalanceBefore)).not.eq("0");
        expect(String(fBalanceAfter)).eq("0");
        expect(cBalanceAfter.gt(cBalanceBefore)).to.be.true;
    });

    it("Should liquidate agent due to collateral token invalidation", async () => {
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
        // invalidate token
        await context.assetManagerController.deprecateCollateralType([context.assetManager.address], CollateralClass.VAULT, context.stablecoins.usdc.address, 1 * DAYS);
        await time.increase(1 * DAYS);
        await time.advanceBlock();
        // liquidator "buys" f-assets
        const poolFees = await agentBot.agent.poolFeeBalance();
        await agentBot.agent.withdrawPoolFees(poolFees, liquidator.address);
        await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
        // FAsset and collateral balance
        const fBalanceBefore = await state.context.fAsset.balanceOf(liquidatorAddress);
        const cBalanceBefore = await vaultCollateralToken.balanceOf(liquidatorAddress);
        const wnBalanceBefore = await context.wNat.balanceOf(liquidatorAddress);
        // liquidate agent
        await liquidator.runStep();
        // check agent status
        await agentBot.runStep(orm.em);
        // FAsset and collateral balance
        const fBalanceAfter = await state.context.fAsset.balanceOf(liquidatorAddress);
        const cBalanceAfter = await vaultCollateralToken.balanceOf(liquidatorAddress);
        const wnBalanceAfter = await context.wNat.balanceOf(liquidatorAddress);
        // check FAsset and cr balance
        const info = await agentBot.agent.getAgentInfo();
        const settings = await context.assetManager.getSettings();
        expect(String(info.mintedUBA)).eq("0");
        expect(String(fBalanceBefore)).not.eq("0");
        expect(String(fBalanceAfter)).eq("0");
        expect(cBalanceAfter.eq(cBalanceBefore)).to.be.true;
        // all liquidator payment should be in pool collateral
        const price = state.prices.get({ collateralClass: CollateralClass.POOL, token: context.wNat.address });
        const received = wnBalanceAfter.sub(wnBalanceBefore);
        const shouldReceive = price.convertUBAToTokenWei(fBalanceBefore)
            .mul(toBN(settings.liquidationCollateralFactorBIPS[0])).divn(MAX_BIPS);
        expect(String(received)).eq(String(shouldReceive));
    });

    it("Should catch full liquidation", async () => {
        const challengerState = new TrackedState(trackedStateContext, await web3.eth.getBlockNumber());
        await challengerState.initialize();
        const challenger = await createTestChallenger(trackedStateContext, challengerAddress, challengerState);
        const liquidator = await createTestLiquidator(trackedStateContext, liquidatorAddress, state);
        const spyLiquidation = spy.on(liquidator.liquidationStrategy, "liquidate");
        const spyChlg = spy.on(challenger, "illegalTransactionChallenge");
        // create test actors
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        await challenger.runStep();
        // create collateral reservation and perform minting
        const minted = await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2, orm, chain);
        await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
        // perform illegal payment
        const agentInfo = await agentBot.agent.getAgentInfo();
        await agentBot.agent.performPayment(agentInfo.underlyingAddressString, toBN(agentInfo.mintedUBA).divn(2));
        // run challenger's steps until agent's status is FULL_LIQUIDATION
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await sleep(100);
            await challenger.runStep();
            const agentStatus = await getAgentStatus(agentBot);
            console.log(`Challenger step ${i}, agent status = ${AgentStatus[agentStatus]}`);
            if (agentStatus === AgentStatus.FULL_LIQUIDATION) break;
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        // send notification
        await agentBot.runStep(orm.em);
        // check status
        const agentStatus = await getAgentStatus(agentBot);
        assert.equal(agentStatus, AgentStatus.FULL_LIQUIDATION);
        expect(spyChlg).to.have.been.called.once;
        // catch event
        const fBalanceBefore = await state.context.fAsset.balanceOf(liquidatorAddress);
        await liquidator.runStep();
        const fBalanceAfter = await state.context.fAsset.balanceOf(liquidatorAddress);
        expect(Number(fBalanceBefore)).to.be.gt(Number(fBalanceAfter));
        expect(spyLiquidation).to.have.been.called.once;
    });

    it("should put an agent into ccb liquidation, then liquidate it when able to", async () => {
        const liquidator = await createTestLiquidator(trackedStateContext, liquidatorAddress, state);
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, accounts[82]);
        // vaultCollateralToken
        const collateralType = await agentBot.agent.getVaultCollateral()
        const minter = await createTestMinter(context, liquidator.address, chain);
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
        await minter.executeMinting(crt, txHash0);
        await agentBot.runStep(orm.em);
        // calculate vault collateral price that brings CR to ccbMinCollateralRatioBIPS
        const { 0: assetFtsoPrice, 2: assetFtsoDecimals } = await context.assetFtso.getCurrentPriceWithDecimals();
        const { 2: vaultFtsoDecimals } = await context.ftsos.usdc.getCurrentPriceWithDecimals();
        const assetTokenDecimals = await context.fAsset.decimals();
        const agentInfo = await agentBot.agent.getAgentInfo();
        const vaultTokenPrice = assetPriceForAgentCr(
            toBN(collateralType.ccbMinCollateralRatioBIPS).addn(7),
            toBN(agentInfo.mintedUBA),
            toBN(agentInfo.totalVaultCollateralWei),
            assetFtsoPrice,
            Number(assetFtsoDecimals),
            Number(assetTokenDecimals),
            Number(vaultFtsoDecimals),
            Number(collateralType.decimals),
        )
        await context.ftsos.usdc.setCurrentPrice(vaultTokenPrice, 0);
        await context.ftsos.usdc.setCurrentPriceFromTrustedProviders(vaultTokenPrice, 0);
        await context.ftsoManager.mockFinalizePriceEpoch();
        // check that collateral ratios and agent status are set up correctly for the upcomming liquidations
        const agentInfo2 = await agentBot.agent.getAgentInfo();
        expect(Number(agentInfo2.vaultCollateralRatioBIPS)).to.be.gte(Number(collateralType.ccbMinCollateralRatioBIPS));
        expect(Number(agentInfo2.vaultCollateralRatioBIPS)).to.be.lte(Number(collateralType.ccbMinCollateralRatioBIPS) + 10);
        expect(Number(agentInfo2.status)).equals(AgentStatus.NORMAL);
        // expect to trigger liquidation
        await liquidator.runStep();
        const agentInfo3 = await agentBot.agent.getAgentInfo();
        expect(Number(agentInfo3.status)).equals(AgentStatus.CCB);
        // liquidate after ccb
        const settings = await context.assetManager.getSettings();
        await time.increase(settings.ccbTimeSeconds);
        await liquidator.runStep();
        // expect that the agent was pulled out of liquidation
        await context.assetManager.endLiquidation(agentBot.agent.vaultAddress);
        const agentInfo4 = await agentBot.agent.getAgentInfo();
        expect(Number(agentInfo4.status)).to.equal(AgentStatus.NORMAL);
    });
});
