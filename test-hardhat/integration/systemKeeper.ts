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
import { SystemKeeper } from "../../src/actors/SystemKeeper";
import { assert } from "chai";
import { ScopedRunner } from "../../src/utils/events/ScopedRunner";
import { TrackedState } from "../../src/state/TrackedState";
import { overrideAndCreateOrm } from "../../src/mikro-orm.config";
import { createTestOrmOptions } from "../../test/test-utils/test-bot-config";
import { Notifier } from "../../src/utils/Notifier";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chai = require('chai');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const spies = require('chai-spies');
chai.use(spies);
const expect = chai.expect;

const minterUnderlying: string = "MINTER_ADDRESS";

describe("System keeper tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext; // due to ftsoManagerMock's mockFinalizePriceEpoch()
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let systemKeeperAddress: string;
    let chain: MockChain;
    let agentBot: AgentBot;
    let minter: Minter;
    let runner: ScopedRunner;
    let state: TrackedState;

    async function createTestSystemKeeper(runner: ScopedRunner, address: string, state: TrackedState): Promise<SystemKeeper> {
        return new SystemKeeper(runner, address, state);
    }

    async function createTestAgentBot(rootEm: EM, context: IAssetBotContext, address: string): Promise<AgentBot> {
        const agentBot = await AgentBot.create(rootEm, context, address, new Notifier());
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
        systemKeeperAddress = accounts[6];
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
        const systemKeeper = await createTestSystemKeeper(runner, systemKeeperAddress, state);
        const spy = chai.spy.on(systemKeeper, 'checkAllAgentsForLiquidation');
        // mock price changes
        await context.ftsoManager.mockFinalizePriceEpoch();
        // check collateral ratio after price changes
        await systemKeeper.runStep();
        expect(spy).to.have.been.called.once;
    });

    it("Should check collateral ratio after minting and price changes - agent from normal -> ccb -> liquidation -> normal", async () => {
        const systemKeeper = await createTestSystemKeeper(runner, systemKeeperAddress, state);
        await createTestActors(ownerAddress, minterAddress, minterUnderlying, context);
        const spy = chai.spy.on(agentBot.notifier, 'sendLiquidationStartAlert');
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 2);
        // check agent status
        const status1 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status1, AgentStatus.NORMAL);
        // change prices
        await context.natFtso.setCurrentPrice(39, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep();
        // check agent status
        const status2 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status2, AgentStatus.CCB);
        // change prices
        await context.natFtso.setCurrentPrice(36, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep();
        // check agent status
        const status3 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status3, AgentStatus.LIQUIDATION);
        // change prices
        await context.natFtso.setCurrentPrice(150, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep();
        // check agent status
        const status4 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status4, AgentStatus.NORMAL);
        // send notification
        await agentBot.runStep(orm.em);
        expect(spy).to.have.been.called.once;
    });

    it("Should check collateral ratio after price changes - agent from normal -> liquidation -> normal -> ccb -> normal", async () => {
        const systemKeeper = await createTestSystemKeeper(runner, systemKeeperAddress, state);
        await createTestActors(ownerAddress, minterAddress, minterUnderlying, context);
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 2);
        // check agent status
        const status1 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status1, AgentStatus.NORMAL);
        // change prices
        await context.natFtso.setCurrentPrice(36, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep();
        // check agent status
        const status2 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status2, AgentStatus.LIQUIDATION);
        // change prices
        await context.natFtso.setCurrentPrice(34, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep();
        // check agent status
        const status3 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status3, AgentStatus.LIQUIDATION);
        // change prices
        await context.natFtso.setCurrentPrice(150, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep();
        // check agent status
        const status4 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status4, AgentStatus.NORMAL);
        // change prices
        await context.natFtso.setCurrentPrice(39, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep();
        // check agent status
        const status5 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status5, AgentStatus.CCB);
        // change prices
        await context.natFtso.setCurrentPrice(38, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep();
        // check agent status
        const status6 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status6, AgentStatus.CCB);
        // change prices
        await context.natFtso.setCurrentPrice(150, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep();
        // check agent status
        const status7 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status7, AgentStatus.NORMAL);
    });

    it("Should check collateral ratio after minting execution", async () => {
        const systemKeeper = await createTestSystemKeeper(runner, systemKeeperAddress, state);
        await createTestActors(ownerAddress, minterAddress, minterUnderlying, context);
        const spy = chai.spy.on(systemKeeper, 'handleMintingExecuted');
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 2);
        // check collateral ratio after minting execution
        await systemKeeper.runStep();
        expect(spy).to.have.been.called.once;
    });

});