import { FilterQuery } from "@mikro-orm/core/typings";
import { AgentBotRunner } from "../../../src/actors/AgentBotRunner";
import { ORM } from "../../../src/config/orm";
import { AgentEntity } from "../../../src/entities/agent";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { web3 } from "../../../src/utils/web3";
import { SourceId } from "../../../src/verification/sources/sources";
import { createTestOrm } from "../../../test/test.mikro-orm.config";
import { testChainInfo } from "../../../test/utils/TestChainInfo";
import { disableMccTraceManager } from "../../utils/helpers";
import { createTestAssetContext, TestAssetBotContext } from "../../utils/test-asset-context";
const chai = require('chai');
const spies = require('chai-spies');
chai.use(spies);
const expect = chai.expect;

describe("Agent bot runner tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
        orm = await createTestOrm({ schemaUpdate: 'recreate' });
        ownerAddress = accounts[3];
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
    });

    it("Should create agent bot runner", async () => {
        const contexts: Map<number, IAssetBotContext> = new Map();
        contexts.set(context.chainInfo.chainId, context);
        const agentBotRunner = new AgentBotRunner(contexts, orm, 5);
        expect(agentBotRunner.loopDelay).to.eq(5);
        expect(agentBotRunner.contexts.get(context.chainInfo.chainId)).to.not.be.null;
    });

    it("Should create missing agents for agent bot runner", async () => {
        const contexts: Map<number, IAssetBotContext> = new Map();
        contexts.set(context.chainInfo.chainId, context);
        const loopDelay = 2;
        const agentBotRunner = new AgentBotRunner(contexts, orm, loopDelay);
        expect(agentBotRunner.loopDelay).to.eq(loopDelay);
        expect(agentBotRunner.contexts.get(context.chainInfo.chainId)).to.not.be.null;
        await agentBotRunner.createMissingAgents(ownerAddress);
        const existing1 = await orm.em.count(AgentEntity, { chainId: context.chainInfo.chainId, active: true } as FilterQuery<AgentEntity>);
        expect(existing1).to.eq(1);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { active: true } as FilterQuery<AgentEntity>);
        agentEnt.active = false;
        await orm.em.persistAndFlush(agentEnt);
        const existing2 = await orm.em.count(AgentEntity, { chainId: context.chainInfo.chainId, active: true } as FilterQuery<AgentEntity>);
        expect(existing2).to.eq(0);
        await agentBotRunner.createMissingAgents(ownerAddress);
        const existing3 = await orm.em.count(AgentEntity, { chainId: context.chainInfo.chainId, active: true } as FilterQuery<AgentEntity>);
        expect(existing3).to.eq(1);
    });

    it.skip("Should run agent bot runner until its stopped", async () => {
        const contexts: Map<number, IAssetBotContext> = new Map();
        contexts.set(context.chainInfo.chainId, context);
        const loopDelay = 2;
        const agentBotRunner = new AgentBotRunner(contexts, orm, loopDelay);
        const spy = chai.spy.on(agentBotRunner, 'requestStop');
        agentBotRunner.requestStop();
        await agentBotRunner.run();
        expect(spy).to.have.been.called.once;
    });

    it("Should run agent bot runner step", async () => {
        const contexts: Map<number, IAssetBotContext> = new Map();
        contexts.set(context.chainInfo.chainId, context);
        const loopDelay = 2;
        const agentBotRunner = new AgentBotRunner(contexts, orm, loopDelay);
        const spy = chai.spy.on(agentBotRunner, 'runStep');
        await agentBotRunner.createMissingAgents(ownerAddress);
        await agentBotRunner.runStep();
        expect(spy).to.have.been.called.once;
    });

    it("Should run agent bot runner step 2", async () => {
        const contexts: Map<number, IAssetBotContext> = new Map();
        contexts.set(context.chainInfo.chainId, context);
        const loopDelay = 2;
        const agentBotRunner = new AgentBotRunner(contexts, orm, loopDelay);
        const spy = chai.spy.on(agentBotRunner, 'runStep');
        await agentBotRunner.createMissingAgents(ownerAddress);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { ownerAddress: ownerAddress, active: true } as FilterQuery<AgentEntity>);
        agentEnt.chainId = SourceId.BTC;
        await orm.em.persistAndFlush(agentEnt);
        await agentBotRunner.runStep();
        expect(spy).to.have.been.called.once;
    });

});