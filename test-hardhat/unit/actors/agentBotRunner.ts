import { ORM } from "../../../src/config/orm";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { web3 } from "../../../src/utils/web3";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { createTestAgentBotRunner, disableMccTraceManager } from "../../test-utils/helpers";
import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/create-test-asset-context";
import spies from "chai-spies";
import { expect, spy, use } from "chai";
use(spies);

const loopDelay: number = 2;
describe("Agent bot runner tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    const contexts: Map<number, TestAssetBotContext> = new Map();

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
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

});