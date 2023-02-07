import { AgentBot, AgentStatus } from "../../src/actors/AgentBot";
import { EM, ORM } from "../../src/config/orm";
import { Minter } from "../../src/mock/Minter";
import { MockChain } from "../../src/mock/MockChain";
import { checkedCast, sleep, toBN, toBNExp } from "../../src/utils/helpers";
import { web3 } from "../../src/utils/web3";
import { createTestAssetContext, TestAssetBotContext } from "../utils/test-asset-context";
import { testChainInfo } from "../../test/utils/TestChainInfo";
import { IAssetBotContext } from "../../src/fasset-bots/IAssetBotContext";
import { FilterQuery } from "@mikro-orm/core/typings";
import { ActorEntity, ActorType } from "../../src/entities/actor";
import { disableMccTraceManager } from "../utils/helpers";
import { SystemKeeper } from "../../src/actors/SystemKeeper";
import { AgentEntity } from "../../src/entities/agent";
import { assert } from "chai";
import { ScopedRunner } from "../../src/utils/events/ScopedRunner";
import { time } from "@openzeppelin/test-helpers";
import { TrackedState } from "../../src/state/TrackedState";
import { Challenger } from "../../src/actors/Challenger";
import { PaymentReference } from "../../src/fasset/PaymentReference";
import { overrideAndCreateOrm } from "../../src/mikro-orm.config";
import { createTestOrmOptions } from "../../test/utils/test-bot-config";
const chai = require('chai');
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
    let challengerAddress: string;
    let systemKeeperAddress: string;
    let chain: MockChain;
    let agentBot: AgentBot;
    let minter: Minter;
    let runner: ScopedRunner;
    let state: TrackedState;

    async function createTestSystemKeeper(runner: ScopedRunner, rootEm: EM, context: IAssetBotContext, address: string, state: TrackedState): Promise<SystemKeeper> {
        const ccbTriggerEnt = await rootEm.findOne(ActorEntity, { address: address, type: ActorType.SYSTEM_KEEPER } as FilterQuery<ActorEntity>);
        if (ccbTriggerEnt) {
            return await SystemKeeper.fromEntity(runner, context, ccbTriggerEnt, state);
        } else {
            return await SystemKeeper.create(runner, rootEm, context, address, state);
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
        challengerAddress = accounts[5];
        systemKeeperAddress = accounts[6];
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
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
        const systemKeeper = await createTestSystemKeeper(runner, orm.em, context, systemKeeperAddress, state);
        await systemKeeper.initialize();
        const spy = chai.spy.on(systemKeeper, 'checkAllAgentsForLiquidation');
        // mock price changes
        await context.ftsoManager.mockFinalizePriceEpoch();
        // check collateral ratio after price changes
        await systemKeeper.runStep(orm.em);
        expect(spy).to.have.been.called.once;
    });

    it("Should check collateral ratio after minting and price changes - agent from normal -> ccb -> liquidation -> normal", async () => {
        const systemKeeper = await createTestSystemKeeper(runner, orm.em, context, systemKeeperAddress, state);
        await systemKeeper.initialize();
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
        await systemKeeper.runStep(orm.em);
        // check agent status
        const status2 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status2, AgentStatus.CCB);
        // change prices
        await context.natFtso.setCurrentPrice(36, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep(orm.em);
        // check agent status
        const status3 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status3, AgentStatus.LIQUIDATION);
        // change prices
        await context.natFtso.setCurrentPrice(150, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep(orm.em);
        // check agent status
        const status4 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status4, AgentStatus.NORMAL);
        // send notification
        await agentBot.runStep(orm.em);
    });

    it("Should check collateral ratio after price changes - agent from normal -> liquidation -> normal -> ccb -> normal", async () => {
        const systemKeeper = await createTestSystemKeeper(runner, orm.em, context, systemKeeperAddress, state);
        await systemKeeper.initialize();
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
        await systemKeeper.runStep(orm.em);
        // check agent status
        const status2 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status2, AgentStatus.LIQUIDATION);
        // change prices
        await context.natFtso.setCurrentPrice(34, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep(orm.em);
        // check agent status
        const status3 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status3, AgentStatus.LIQUIDATION);
        // change prices
        await context.natFtso.setCurrentPrice(150, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep(orm.em);
        // check agent status
        const status4 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status4, AgentStatus.NORMAL);
        // change prices
        await context.natFtso.setCurrentPrice(39, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep(orm.em);
        // check agent status
        const status5 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status5, AgentStatus.CCB);
        // change prices
        await context.natFtso.setCurrentPrice(38, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep(orm.em);
        // check agent status
        const status6 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status6, AgentStatus.CCB);
        // change prices
        await context.natFtso.setCurrentPrice(150, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await systemKeeper.runStep(orm.em);
        // check agent status
        const status7 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status7, AgentStatus.NORMAL);
    });

    it("Should check collateral ratio after minting execution", async () => {
        const systemKeeper = await createTestSystemKeeper(runner, orm.em, context, systemKeeperAddress, state);
        await systemKeeper.initialize();
        await createTestActors(ownerAddress, minterAddress, minterUnderlying, context);
        const spy = chai.spy.on(systemKeeper, 'handleMintingExecuted');
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 2);
        // check collateral ratio after minting execution
        await systemKeeper.runStep(orm.em);
        expect(spy).to.have.been.called.once;
    });

    it("Should not handle minting - no tracked agent", async () => {
        await createTestActors(ownerAddress, minterAddress, minterUnderlying, context);
        const systemKeeper = await SystemKeeper.create(runner, orm.em, context, accounts[71], state);
        await systemKeeper.initialize();
        // check tracked agents
        assert.equal(systemKeeper.state.agents.size, 0);
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 2);
        // check tracked agents
        await systemKeeper.runStep(orm.em);
        assert.equal(systemKeeper.state.agents.size, 0);
    });

    it("Should not handle agent status change - no tracked agent", async () => {
        const challenger = await Challenger.create(runner, orm.em, context, challengerAddress, new TrackedState());
        // create test actors
        await createTestActors(ownerAddress, minterAddress, minterUnderlying, context);
        // create liquidator
        const systemKeeper = await SystemKeeper.create(runner, orm.em, context, accounts[70], state);
        await systemKeeper.initialize();
        await challenger.runStep(orm.em);
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 2);
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 2);
        // perform illegal payment
        const agentInfo = await agentBot.agent.getAgentInfo();
        await agentBot.agent.performPayment(agentInfo.underlyingAddressString, toBN(agentInfo.mintedUBA).divn(2), PaymentReference.redemption(15));
        // run challenger's steps until agent's status is FULL_LIQUIDATION
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await sleep(3000);
            await challenger.runStep(orm.em);
            const agentStatus = await getAgentStatus(context, agentBot.agent.vaultAddress);
            console.log(`Challenger step ${i}, agent status = ${AgentStatus[agentStatus]}`)
            if (agentStatus === AgentStatus.FULL_LIQUIDATION) break;
        }
        const agentStatus = await getAgentStatus(context, agentBot.agent.vaultAddress);
        assert.equal(agentStatus, AgentStatus.FULL_LIQUIDATION);
        // handle status change
        await systemKeeper.runStep(orm.em);
    });

    it("Should remove agent from tracked state when agent is destroyed", async () => {
        const systemKeeper = await SystemKeeper.create(runner, orm.em, context, accounts[80], state);
        await systemKeeper.initialize();
        const agentBot = await createTestAgentBot(orm.em, context, accounts[81]);
        await systemKeeper.runStep(orm.em);
        assert.equal(systemKeeper.state.agents.size, 1);
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
        await systemKeeper.runStep(orm.em);
        assert.equal(systemKeeper.state.agents.size, 0);
    });

    it("Should liquidate agent", async () => {
        const systemKeeper = await createTestSystemKeeper(runner, orm.em, context, systemKeeperAddress, state)
        await systemKeeper.initialize();
        const agentBot = await createTestAgentBot(orm.em, context, accounts[81]);
        await createTestActors(ownerAddress, minterAddress, minterUnderlying, context)
        await systemKeeper.runStep(orm.em);
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
        await context.fAsset.transfer(systemKeeper.address, minted.mintedAmountUBA, { from: minter.address });
        // liquidate agent (partially)
        const liquidateMaxUBA = minted.mintedAmountUBA.divn(lots);
        await context.assetManager.liquidate(agentBot.agent.agentVault.address, liquidateMaxUBA, { from: systemKeeper.address });
        // check agent status
        await agentBot.runStep(orm.em);
        const status2 = await getAgentStatus(context, agentBot.agent.agentVault.address);
        assert.equal(status2, AgentStatus.LIQUIDATION);
    });

});