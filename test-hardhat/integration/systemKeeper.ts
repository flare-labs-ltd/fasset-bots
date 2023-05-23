import { ORM } from "../../src/config/orm";
import { MockChain } from "../../src/mock/MockChain";
import { checkedCast, toBNExp } from "../../src/utils/helpers";
import { web3 } from "../../src/utils/web3";
import { createTestAssetContext, getTestAssetTrackedStateContext, TestAssetBotContext, TestAssetTrackedStateContext } from "../test-utils/create-test-asset-context";
import { testChainInfo } from "../../test/test-utils/TestChainInfo";
import { createCRAndPerformMinting, createTestMinter, createTestSystemKeeper, disableMccTraceManager, getAgentStatus, createTestAgentBotAndMakeAvailable } from "../test-utils/helpers";
import { assert } from "chai";
import { TrackedState } from "../../src/state/TrackedState";
import { overrideAndCreateOrm } from "../../src/mikro-orm.config";
import { createTestOrmOptions } from "../../test/test-utils/test-bot-config";
import spies from "chai-spies";
import { expect, spy, use } from "chai";
import { time } from "@openzeppelin/test-helpers";
import { AgentStatus } from "../../src/fasset/AssetManagerTypes";
use(spies);

describe("System keeper tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let trackedStateContext: TestAssetTrackedStateContext;
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let systemKeeperAddress: string;
    let chain: MockChain;
    let state: TrackedState;

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
        ownerAddress = accounts[3];
        minterAddress = accounts[4];
        systemKeeperAddress = accounts[6];
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        trackedStateContext = getTestAssetTrackedStateContext(context);
        chain = checkedCast(trackedStateContext.chain, MockChain);
        // chain tunning
        chain.finalizationBlocks = 0;
        chain.secondsPerBlock = 1;
        const lastBlock = await web3.eth.getBlockNumber();
        state = new TrackedState(context, lastBlock);
        await state.initialize();
    });

    it("Should check collateral ratio after price changes", async () => {
        const systemKeeper = await createTestSystemKeeper(systemKeeperAddress, state);
        const spyLiquidation = spy.on(systemKeeper, 'checkAllAgentsForLiquidation');
        // mock price changes
        await context.ftsoManager.mockFinalizePriceEpoch();
        // check collateral ratio after price changes
        await systemKeeper.runStep();
        expect(spyLiquidation).to.have.been.called.once;
    });

    it("Should check collateral ratio after minting and price changes - agent from normal -> ccb -> liquidation -> normal", async () => {
        const systemKeeper = await createTestSystemKeeper(systemKeeperAddress, state);
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        const spyLiquidation = spy.on(agentBot.notifier, 'sendLiquidationStartAlert');
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot.agent.vaultAddress, 2, chain);
        // check agent status
        const status1 = await getAgentStatus(agentBot);
        assert.equal(status1, AgentStatus.NORMAL);
        // change prices
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep();
        // check agent status
        const status2 = await getAgentStatus(agentBot);
        assert.equal(status2, AgentStatus.CCB);
        // change prices
        await context.assetFtso.setCurrentPrice(toBNExp(10, 7), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(10, 7), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep();
        // check agent status
        const status3 = await getAgentStatus(agentBot);
        assert.equal(status3, AgentStatus.LIQUIDATION);
        // change prices
        await context.assetFtso.setCurrentPrice(toBNExp(10, 4), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(10, 4), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep();
        // check agent status
        const status4 = await getAgentStatus(agentBot);
        assert.equal(status4, AgentStatus.NORMAL);
        // send notification
        await agentBot.runStep(orm.em);
        expect(spyLiquidation).to.have.been.called.once;
    });

    it("Should check price changes - agent from normal -> ccb -> liquidation (timestamp)", async () => {
        const systemKeeper = await createTestSystemKeeper(systemKeeperAddress, state);
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        const spyCCBAlert = spy.on(agentBot.notifier, 'sendCCBAlert');
        const spyPoolTopUpAlert = spy.on(agentBot.notifier, 'sendCollateralTopUpAlert');
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot.agent.vaultAddress, 2, chain);
        // check agent status
        const status1 = await getAgentStatus(agentBot);
        assert.equal(status1, AgentStatus.NORMAL);
        // change prices
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep();
        // check agent status
        const status2 = await getAgentStatus(agentBot);
        assert.equal(status2, AgentStatus.CCB);
        // increase time to get liquidation
        const settings = await context.assetManager.getSettings();
        await time.increase(settings.ccbTimeSeconds);
        await systemKeeper.runStep();
        const status3 = await getAgentStatus(agentBot);
        assert.equal(status3, AgentStatus.LIQUIDATION);
        // send notification
        await agentBot.runStep(orm.em);
        expect(spyCCBAlert).to.have.been.called.once;
        expect(spyPoolTopUpAlert).to.have.been.called.once;
    });

    it("Should check price changes - agent from normal -> ccb -> liquidation", async () => {
        const systemKeeper = await createTestSystemKeeper(systemKeeperAddress, state);
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        const spyCCBAlert = spy.on(agentBot.notifier, 'sendCCBAlert');
        const spyPoolTopUpAlert = spy.on(agentBot.notifier, 'sendCollateralTopUpAlert');
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot.agent.vaultAddress, 2, chain);
        // check agent status
        const status1 = await getAgentStatus(agentBot);
        assert.equal(status1, AgentStatus.NORMAL);
        // change prices
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep();
        // check agent status
        const status2 = await getAgentStatus(agentBot);
        assert.equal(status2, AgentStatus.CCB);
        // change prices
        await context.assetFtso.setCurrentPrice(toBNExp(11, 5), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(11, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep();
        // no changes
        await systemKeeper.runStep();
        const status3 = await getAgentStatus(agentBot);
        assert.equal(status3, AgentStatus.LIQUIDATION);
        // send notification
        await agentBot.runStep(orm.em);
        expect(spyCCBAlert).to.have.been.called.once;
        expect(spyPoolTopUpAlert).to.have.been.called.once;
    });

    it("Should check collateral ratio after price changes - agent from normal -> liquidation -> normal -> ccb -> normal", async () => {
        const systemKeeper = await createTestSystemKeeper(systemKeeperAddress, state);
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot.agent.vaultAddress, 2, chain);
        // check agent status
        const status1 = await getAgentStatus(agentBot);
        assert.equal(status1, AgentStatus.NORMAL);
        // change prices
        await context.assetFtso.setCurrentPrice(toBNExp(10, 7), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(10, 7), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep();
        // check agent status
        const status2 = await getAgentStatus(agentBot);
        assert.equal(status2, AgentStatus.LIQUIDATION);
        // // change prices
        await context.assetFtso.setCurrentPrice(toBNExp(10, 4), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(10, 4), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep();
        // check agent status
        const status4 = await getAgentStatus(agentBot);
        assert.equal(status4, AgentStatus.NORMAL);
        // change prices
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep();
        // check agent status
        const status5 = await getAgentStatus(agentBot);
        assert.equal(status5, AgentStatus.CCB);
        // change prices
        await context.assetFtso.setCurrentPrice(toBNExp(10, 4), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(10, 4), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep();
        // check agent status
        const status7 = await getAgentStatus(agentBot);
        assert.equal(status7, AgentStatus.NORMAL);
    });

    it("Should check collateral ratio after minting execution", async () => {
        const systemKeeper = await createTestSystemKeeper(systemKeeperAddress, state);
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        const spyMinting = spy.on(systemKeeper, 'handleMintingExecuted');
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot.agent.vaultAddress, 2, chain);
        // check collateral ratio after minting execution
        await systemKeeper.runStep();
        expect(spyMinting).to.have.been.called.once;
    });

});