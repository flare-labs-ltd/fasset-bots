import { FilterQuery } from "@mikro-orm/core/typings";
import { AgentBot } from "../../../src/actors/AgentBot";
import { AgentBotRunner } from "../../../src/actors/AgentBotRunner";
import { ORM } from "../../../src/config/orm";
import { AgentEntity } from "../../../src/entities/agent";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { Notifier } from "../../../src/utils/Notifier";
import { web3 } from "../../../src/utils/web3";
import { SourceId } from "../../../src/verification/sources/sources";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { disableMccTraceManager } from "../../test-utils/helpers";
import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/test-asset-context";
import spies from "chai-spies";
import { expect, spy, use } from "chai";
use(spies);

const loopDelay: number = 2;
describe("Agent bot runner tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    // let ownerAddress: string;
    const contexts: Map<number, IAssetBotContext> = new Map();

    function createAgentBot() {
        return new AgentBotRunner(contexts, orm, loopDelay, new Notifier());
    }

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
        // ownerAddress = accounts[3];
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        contexts.set(context.chainInfo.chainId, context);
    });

    it("Should create agent bot runner", async () => {
        const agentBotRunner = createAgentBot();
        expect(agentBotRunner.loopDelay).to.eq(loopDelay);
        expect(agentBotRunner.contexts.get(context.chainInfo.chainId)).to.not.be.null;
    });

    it("Should run agent bot runner until its stopped", async () => {
        const agentBotRunner = createAgentBot();
        const spyStep = spy.on(agentBotRunner, 'runStep');
        agentBotRunner.requestStop();
        void agentBotRunner.run();
        agentBotRunner.requestStop();
        expect(spyStep).to.have.been.called.once;
    });
/*
    it("Should run agent bot runner step", async () => {
        const agentBotRunner = createAgentBot();
        const spyEnt = spy.on(AgentBot, 'fromEntity');
        await agentBotRunner.createMissingAgents(ownerAddress);
        await agentBotRunner.runStep();
        expect(spyEnt).to.have.been.called.once;
    });

    it("Should run agent bot runner step - invalid source id", async () => {
        const agentBotRunner = createAgentBot();
        const spyLog = spy.on(console, 'warn');
        await agentBotRunner.createMissingAgents(ownerAddress);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { ownerAddress: ownerAddress, active: true } as FilterQuery<AgentEntity>);
        agentEnt.chainId = SourceId.BTC;
        await orm.em.persistAndFlush(agentEnt);
        await agentBotRunner.runStep();
        expect(spyLog).to.have.been.called.once;
    });
*/
});