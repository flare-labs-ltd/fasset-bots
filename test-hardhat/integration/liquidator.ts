import { AgentBot, AgentStatus } from "../../src/actors/AgentBot";
import { EM, ORM } from "../../src/config/orm";
import { Minter } from "../../src/mock/Minter";
import { MockChain } from "../../src/mock/MockChain";
import { checkedCast, toBNExp } from "../../src/utils/helpers";
import { web3 } from "../../src/utils/web3";
import { createTestAssetContext, TestAssetBotContext } from "../test-utils/test-asset-context";
import { testChainInfo } from "../../test/test-utils/TestChainInfo";
import { IAssetBotContext } from "../../src/fasset-bots/IAssetBotContext";
import { disableMccTraceManager } from "../test-utils/helpers";
import { assert } from "chai";
import { ScopedRunner } from "../../src/utils/events/ScopedRunner";
import { TrackedState } from "../../src/state/TrackedState";
import { overrideAndCreateOrm } from "../../src/mikro-orm.config";
import { createTestOrmOptions } from "../../test/test-utils/test-bot-config";
import { Liquidator } from "../../src/actors/Liquidator";
const chai = require('chai');
const spies = require('chai-spies');
chai.use(spies);
const expect = chai.expect;

const minterUnderlying: string = "MINTER_ADDRESS";

describe("Liquidator tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext; // due to ftsoManagerMock's mockFinalizePriceEpoch()
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let liquidatorAddress: string;
    let chain: MockChain;
    let agentBot: AgentBot;
    let minter: Minter;
    let runner: ScopedRunner;
    let state: TrackedState;

    async function createTestLiquidator(runner: ScopedRunner, address: string, state: TrackedState): Promise<Liquidator> {
        return new Liquidator(runner, address, state);
    }

    async function createTestAgentBot(rootEm: EM, context: IAssetBotContext, address: string): Promise<AgentBot> {
        const agentBot = await AgentBot.create(rootEm, context, address);
        await agentBot.agent.depositCollateral(toBNExp(100_000_000, 18));
        await agentBot.agent.makeAvailable(500, 3_0000);
        return agentBot;
    }

    async function createCRAndPerformMinting(minter: Minter, agentBot: AgentBot, lots: number): Promise<void> {
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, lots);
        await agentBot.runStep(orm.em);
        const txHash0 = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash0);
        await agentBot.runStep(orm.em);
    }

    async function createTestActors(ownerAddress: string, minterAddress: string, minterUnderlying: string, context: IAssetBotContext): Promise<void> {
        agentBot = await createTestAgentBot(orm.em, context, ownerAddress);
        minter = await Minter.createTest(context, minterAddress, minterUnderlying, toBNExp(100_000, 18));
        chain.mine(chain.finalizationBlocks + 1);
    }

    async function getAgentStatus(context: IAssetBotContext, vaultAddress: string): Promise<AgentStatus> {
        const agentInfo = await context.assetManager.getAgentInfo(vaultAddress);
        return Number(agentInfo.status);
    }

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
        runner = new ScopedRunner();
        const lastBlock = await web3.eth.getBlockNumber();
        state = new TrackedState(context, lastBlock);
        await state.initialize();
    });

    it("Should check collateral ratio after price changes", async () => {
        const liquidator = await createTestLiquidator(runner, liquidatorAddress, state);
        const spy = chai.spy.on(liquidator, 'checkAllAgentsForLiquidation');
        // mock price changes
        await context.ftsoManager.mockFinalizePriceEpoch();
        // check collateral ratio after price changes
        await liquidator.runStep();
        expect(spy).to.have.been.called.once;
    });

    it("Should liquidate agent when status from normal -> liquidation after price changes", async () => {
        const liquidator = await createTestLiquidator(runner, liquidatorAddress, state);
        await createTestActors(ownerAddress, minterAddress, minterUnderlying, context);
        const spy = chai.spy.on(agentBot.notifier, 'sendLiquidationStartAlert');
        // create collateral reservation, perform minting and run liquidation trigger
        await createCRAndPerformMinting(minter, agentBot, 2);
        await liquidator.runStep();
        // check agent status
        const status1 = await getAgentStatus(context, agentBot.agent.agentVault.address);
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
        const status3 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status3, AgentStatus.LIQUIDATION);
        // FAsset balance
        const fBalanceAfter = await state.context.fAsset.balanceOf(liquidatorAddress);
        // send notification
        await agentBot.runStep(orm.em);
        expect(spy).to.have.been.called.once;
        // nothing is burned, liquidator does not have FAssets
        expect(fBalanceBefore.eq(fBalanceAfter)).to.be.true;
        expect(fBalanceBefore.eqn(0)).to.be.true;
    });

    it("Should check collateral ratio after minting execution", async () => {
        const liquidator = await createTestLiquidator(runner, liquidatorAddress, state);
        await createTestActors(ownerAddress, minterAddress, minterUnderlying, context);
        const spy = chai.spy.on(liquidator, 'handleMintingExecuted');
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 2);
        // check collateral ratio after minting execution
        await liquidator.runStep();
        expect(spy).to.have.been.called.once;
    });

    it("Should liquidate agent", async () => {
        const liquidator = await createTestLiquidator(runner, liquidatorAddress, state);
        const agentBot = await createTestAgentBot(orm.em, context, accounts[81]);
        await createTestActors(ownerAddress, minterAddress, minterUnderlying, context)
        await liquidator.runStep();
        // check agent status
        const status1 = await getAgentStatus(context, agentBot.agent.agentVault.address);
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
        const cBalanceBefore = await state.context.wnat.balanceOf(liquidatorAddress);
        // liquidate agent (partially)
        const liquidateMaxUBA = minted.mintedAmountUBA.divn(lots);
        await context.assetManager.liquidate(agentBot.agent.agentVault.address, liquidateMaxUBA, { from: liquidator.address });
        // check agent status
        await agentBot.runStep(orm.em);
        const status2 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status2, AgentStatus.LIQUIDATION);
        // FAsset and collateral balance
        const fBalanceAfter = await state.context.fAsset.balanceOf(liquidatorAddress);
        const cBalanceAfter = await state.context.wnat.balanceOf(liquidatorAddress);
        // check FAsset balance
        expect((fBalanceBefore.sub(liquidateMaxUBA)).toString()).to.eq(fBalanceAfter.toString());
        expect((cBalanceAfter.gt(cBalanceBefore))).to.be.true;
    });

});