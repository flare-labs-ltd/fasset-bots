import { AgentBot, AgentStatus } from "../../src/actors/AgentBot";
import { EM, ORM } from "../../src/config/orm";
import { Minter } from "../../src/mock/Minter";
import { MockChain } from "../../src/mock/MockChain";
import { checkedCast, toBNExp } from "../../src/utils/helpers";
import { web3 } from "../../src/utils/web3";
import { createTestOrm } from "../../test/test.mikro-orm.config";
import { createTestAssetContext, TestAssetBotContext } from "../utils/test-asset-context";
import { testChainInfo } from "../../test/utils/TestChainInfo";
import { IAssetBotContext } from "../../src/fasset-bots/IAssetBotContext";
import { FilterQuery } from "@mikro-orm/core/typings";
import { ActorEntity, ActorType } from "../../src/entities/actor";
import { disableMccTraceManager } from "../utils/helpers";
import { LiquidationTrigger } from "../../src/actors/LiquidationTrigger";
import { AgentEntity } from "../../src/entities/agent";
import { assert } from "chai";
import { ScopedRunner } from "../../src/utils/events/ScopedRunner";
import { time } from "@openzeppelin/test-helpers";
import { TrackedState } from "../../src/state/TrackedState";
const chai = require('chai');
const spies = require('chai-spies');
chai.use(spies);
const expect = chai.expect;

const minterUnderlying: string = "MINTER_ADDRESS";

describe("Liquidation trigger tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext; // due to ftsoManagerMock's mockFinalizePriceEpoch()
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let liquidationTriggerAddress: string;
    let chain: MockChain;
    let agentBot: AgentBot;
    let minter: Minter;
    let runner: ScopedRunner;
    let state: TrackedState;

    async function createTestLiquidationTrigger(runner: ScopedRunner, rootEm: EM, context: IAssetBotContext, address: string, state: TrackedState): Promise<LiquidationTrigger> {
        const ccbTriggerEnt = await rootEm.findOne(ActorEntity, { address: address, type: ActorType.LIQUIDATION_TRIGGER } as FilterQuery<ActorEntity>);
        if (ccbTriggerEnt) {
            return await LiquidationTrigger.fromEntity(runner, context, ccbTriggerEnt, state);
        } else {
            return await LiquidationTrigger.create(runner, rootEm, context, address, state);
        }
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
        liquidationTriggerAddress = accounts[6];
        orm = await createTestOrm({ schemaUpdate: 'recreate' });
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp, false);
        chain = checkedCast(context.chain, MockChain);
        // chain tunning
        chain.finalizationBlocks = 0;
        chain.secondsPerBlock = 1;
    });

    beforeEach(async () => {
        orm.em.clear();
        runner = new ScopedRunner();
        state = new TrackedState();
    });

    it("Should check collateral ratio after price changes", async () => {
        const liquidationTrigger = await createTestLiquidationTrigger(runner, orm.em, context, liquidationTriggerAddress, state);
        await liquidationTrigger.initialize();
        const spy = chai.spy.on(liquidationTrigger, 'runStep');
        // mock price changes
        await context.ftsoManager.mockFinalizePriceEpoch();
        // check collateral ratio after price changes
        await liquidationTrigger.runStep(orm.em);
        expect(spy).to.have.been.called.once;
    });

    it("Should check collateral ratio after minting and price changes - agent from normal -> ccb -> liquidation -> normal", async () => {
        const liquidationTrigger = await createTestLiquidationTrigger(runner, orm.em, context, liquidationTriggerAddress, state);
        await liquidationTrigger.initialize();
        await createTestActors(ownerAddress, minterAddress, minterUnderlying, context);
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
        await liquidationTrigger.runStep(orm.em);
        // heck agent status
        const status2 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status2, AgentStatus.CCB);
        // change prices
        await context.natFtso.setCurrentPrice(36, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await liquidationTrigger.runStep(orm.em);
        // check agent status
        const status3 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status3, AgentStatus.LIQUIDATION);
        // change prices
        await context.natFtso.setCurrentPrice(150, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await liquidationTrigger.runStep(orm.em);
        // check agent status
        const status4 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status4, AgentStatus.NORMAL);
    });

    it("Should check collateral ratio after price changes - agent from normal -> liquidation -> normal -> ccb -> normal", async () => {
        const liquidationTrigger = await createTestLiquidationTrigger(runner, orm.em, context, liquidationTriggerAddress, state);
        await liquidationTrigger.initialize();
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
        await liquidationTrigger.runStep(orm.em);
        // check agent status
        const status2 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status2, AgentStatus.LIQUIDATION);
        // change prices
        await context.natFtso.setCurrentPrice(34, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await liquidationTrigger.runStep(orm.em);
        // check agent status
        const status3 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status3, AgentStatus.LIQUIDATION);
        // change prices
        await context.natFtso.setCurrentPrice(150, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await liquidationTrigger.runStep(orm.em);
        // check agent status
        const status4 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status4, AgentStatus.NORMAL);
        // change prices
        await context.natFtso.setCurrentPrice(39, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await liquidationTrigger.runStep(orm.em);
        // check agent status
        const status5 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status5, AgentStatus.CCB);
        // change prices
        await context.natFtso.setCurrentPrice(38, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await liquidationTrigger.runStep(orm.em);
        // check agent status
        const status6 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status6, AgentStatus.CCB);
        // change prices
        await context.natFtso.setCurrentPrice(150, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await liquidationTrigger.runStep(orm.em);
        // check agent status
        const status7 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status7, AgentStatus.NORMAL);
    });

    it("Should check collateral ratio after minting execution", async () => {
        const liquidationTrigger = await createTestLiquidationTrigger(runner, orm.em, context, liquidationTriggerAddress, state);
        await liquidationTrigger.initialize();
        await createTestActors(ownerAddress, minterAddress, minterUnderlying, context);
        const spy = chai.spy.on(liquidationTrigger, 'runStep');
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 2);
        // check collateral ratio after minting execution
        await liquidationTrigger.runStep(orm.em);
        expect(spy).to.have.been.called.once;
    });

    it("Should remove agent when agent is destroyed", async () => {
        const liquidationTrigger = await createTestLiquidationTrigger(runner, orm.em, context, liquidationTriggerAddress, state);
        await liquidationTrigger.initialize();
        await createTestActors(ownerAddress, minterAddress, minterUnderlying, context);
        await liquidationTrigger.runStep(orm.em);
        assert.equal(liquidationTrigger.state.agents.size, 1);
        // check agent status
        const status = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status, AgentStatus.NORMAL);
        // exit available
        await agentBot.agent.exitAvailable();
        // announce agent destruction
        await agentBot.agent.announceDestroy();
        // check agent status
        const status2 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status2, AgentStatus.DESTROYING);
        // increase time
        const settings = await context.assetManager.getSettings();
        await time.increase(Number(settings.withdrawalWaitMinSeconds) * 2);
        // agent destruction
        await agentBot.agent.destroy();
        await agentBot.runStep(orm.em);
        const agentBotEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.agentVault.address, } as FilterQuery<AgentEntity>);
        assert.equal(agentBotEnt.active, false);
        // handle destruction
        await liquidationTrigger.runStep(orm.em);
        assert.equal(liquidationTrigger.state.agents.size, 0);
    });

});