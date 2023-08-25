import { ORM } from "../../../src/config/orm";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { web3 } from "../../../src/utils/web3";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { createTestAgentBot, createTestAgentBotRunner, disableMccTraceManager } from "../../test-utils/helpers";
import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/create-test-asset-context";
import spies from "chai-spies";
import { expect, spy, use } from "chai";
import { AgentEntity } from "../../../src/entities/agent";
import { FilterQuery } from "@mikro-orm/core";
import { FaultyNotifier } from "../../test-utils/FaultyNotifier";
use(spies);

const loopDelay: number = 2;
describe("Agent bot runner tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    const contexts: Map<number, TestAssetBotContext> = new Map();

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
        ownerAddress = accounts[1];
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate', type: 'sqlite' }));
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        contexts.set(context.chainInfo.chainId, context);
    });

    it("Should create agent bot runner", async () => {
        const agentBotRunner = createTestAgentBotRunner(contexts, orm, loopDelay);
        expect(agentBotRunner.loopDelay).to.eq(loopDelay);
        expect(agentBotRunner.contexts.get(context.chainInfo.chainId)).to.not.be.null;
    });

    it("Should run agent bot runner until its stopped", async () => {
        const agentBotRunner = createTestAgentBotRunner(contexts, orm, loopDelay);
        const spyStep = spy.on(agentBotRunner, 'runStep');
        agentBotRunner.requestStop();
        void agentBotRunner.run();
        agentBotRunner.requestStop();
        expect(spyStep).to.have.been.called.once;
    });

    it("Should create agent bot runner and run it", async () => {
        context.blockchainIndexer.chain.mine(10);
        const spyWarn = spy.on(console, 'warn');
        // create agents
        await createTestAgentBot(context, orm, ownerAddress);
        const otherContext = await createTestAssetContext(accounts[0], testChainInfo.btc);
        await createTestAgentBot(otherContext, orm, ownerAddress);
        await createTestAgentBot(context, orm, ownerAddress);
        // create runner
        const agentBotRunner = createTestAgentBotRunner(contexts, orm, loopDelay, new FaultyNotifier());
        expect(agentBotRunner.loopDelay).to.eq(loopDelay);
        expect(agentBotRunner.contexts.get(context.chainInfo.chainId)).to.not.be.null;
        const agentEntities = await orm.em.find(AgentEntity, { active: true } as FilterQuery<AgentEntity>)
        // make faulty entity
        const agentEnt = agentEntities[0];
        agentEnt.vaultAddress = "someString";
        await orm.em.persistAndFlush(agentEnt);
        // run
        await agentBotRunner.runStep();
        expect(agentEntities.length).to.eq(3);
        expect(spyWarn).to.have.been.called.once;
        agentBotRunner.requestStop();
    });

});