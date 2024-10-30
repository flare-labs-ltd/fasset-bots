import { FilterQuery } from "@mikro-orm/core";
import { expect, spy, use } from "chai";
import spies from "chai-spies";
import { AgentBotRunner } from "../../../src";
import { ORM } from "../../../src/config/orm";
import { AgentEntity } from "../../../src/entities/agent";
import { sleep, toBNExp } from "../../../src/utils";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { createTestOrm } from "../../../test/test-utils/create-test-orm";
import { FaultyNotifierTransport } from "../../test-utils/FaultyNotifierTransport";
import { TestAssetBotContext, createTestAssetContext, createTestSecrets } from "../../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../../test-utils/hardhat-test-helpers";
import { createTestAgentBot, createTestAgentBotRunner } from "../../test-utils/helpers";
import { AgentBotUnderlyingManagement } from "../../../src/actors/AgentBotUnderlyingManagement";
use(spies);

const loopDelay: number = 2;
describe("Agent bot runner tests", () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let ownerUnderlyingAddress: string;
    let contexts: Map<string, TestAssetBotContext> = new Map();

    before(async () => {
        accounts = await web3.eth.getAccounts();
        ownerAddress = accounts[1];
        ownerUnderlyingAddress = "underlying_owner_1";
    });

    async function initialize() {
        orm = await createTestOrm();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        await context.agentOwnerRegistry.setWorkAddress(accounts[4], { from: ownerAddress });
        contexts.set(context.fAssetSymbol, context);
        return { orm, context, contexts };
    }

    async function stopRunner(agentBotRunner: AgentBotRunner) {
        agentBotRunner.requestStop();
        if (agentBotRunner.parallel()) {
            while (agentBotRunner.running) {
                await agentBotRunner.runStep();
                await sleep(100);
            }
        }
    }

    beforeEach(async () => {
        ({ orm, context, contexts } = await loadFixtureCopyVars(initialize));
    });

    it("Should create agent bot runner", async () => {
        const secrets = createTestSecrets([context.chainInfo.chainId], ownerAddress, ownerAddress, ownerUnderlyingAddress);
        const agentBotRunner = createTestAgentBotRunner(secrets, contexts, orm, loopDelay);
        expect(agentBotRunner.loopDelay).to.eq(loopDelay);
        expect(agentBotRunner.contexts.get(context.chainInfo.symbol)).to.not.be.null;
    });

    it("Should run agent bot runner until its stopped", async () => {
        const secrets = createTestSecrets([context.chainInfo.chainId], ownerAddress, ownerAddress, ownerUnderlyingAddress);
        const agentBotRunner = createTestAgentBotRunner(secrets, contexts, orm, loopDelay);
        const spyStep = spy.on(agentBotRunner, "runStep");
        agentBotRunner.requestStop();
        const runPromise = agentBotRunner.run();    // run in background
        agentBotRunner.requestStop();
        await runPromise;
        expect(spyStep).to.have.been.called.once;
    });

    it("Should create agent bot runner and run it", async () => {
        context.blockchainIndexer.chain.mine(10);
        // create agents
        await createTestAgentBot(context, orm, ownerAddress, undefined, false);
        const otherContext = await createTestAssetContext(accounts[0], testChainInfo.btc);
        await createTestAgentBot(otherContext, orm, ownerAddress, "UNDERLYING");
        await createTestAgentBot(context, orm, ownerAddress, undefined, false);
        // create runner
        const secrets = createTestSecrets([context.chainInfo.chainId], ownerAddress, ownerAddress, ownerUnderlyingAddress);
        const agentBotRunner = createTestAgentBotRunner(secrets, contexts, orm, loopDelay, [new FaultyNotifierTransport()]);
        console.log(`Parallel: ${agentBotRunner.parallel()}`);
        expect(agentBotRunner.loopDelay).to.eq(loopDelay);
        expect(agentBotRunner.contexts.get(context.chainInfo.symbol)).to.not.be.null;
        const agentEntities = await orm.em.find(AgentEntity, { active: true } as FilterQuery<AgentEntity>);
        // make faulty entity
        const agentEnt = agentEntities[0];
        agentEnt.vaultAddress = "someString";
        await orm.em.persistAndFlush(agentEnt);
        // run
        await agentBotRunner.runStep();
        expect(agentEntities.length).to.eq(3);
        await stopRunner(agentBotRunner);
    });

    it("Should perform automatic underlying topup", async () => {
        const spyTopup = spy.on(AgentBotUnderlyingManagement.prototype, "underlyingTopUp");
        try {
            context.blockchainIndexer.chain.mint(ownerUnderlyingAddress, toBNExp(50, 6));
            context.blockchainIndexer.chain.mine(10);
            // create agents
            await createTestAgentBot(context, orm, ownerAddress, undefined, false);
            // create runner
            const secrets = createTestSecrets([context.chainInfo.chainId], ownerAddress, ownerAddress, ownerUnderlyingAddress);
            const agentBotRunner = createTestAgentBotRunner(secrets, contexts, orm, loopDelay);
            // run step
            await agentBotRunner.runStep();
            // check
            expect(spyTopup).to.be.called.once;
            // create another bot - it should be picked by the runner on next step
            await createTestAgentBot(context, orm, ownerAddress, undefined, false);
            // run step
            await agentBotRunner.runStep();
            // finish
            await stopRunner(agentBotRunner);
            // check for 2
            expect(spyTopup).to.be.called.exactly(2);
        } finally {
            spy.restore(AgentBotUnderlyingManagement.prototype);
        }
    });

    it("Should fund service accounts", async () => {
        const secrets = createTestSecrets([context.chainInfo.chainId], ownerAddress, ownerAddress, ownerUnderlyingAddress);
        const timeKeeperAddress = accounts[23]
        const someAddress = accounts[22]
        const agentBotRunner = createTestAgentBotRunner(secrets, contexts, orm, loopDelay);
        const spyFund = spy.on(agentBotRunner, "fundAccount");
        agentBotRunner.serviceAccounts.set("timeKeeper", timeKeeperAddress)
        agentBotRunner.serviceAccounts.set("someAddress", someAddress)
        agentBotRunner.requestStop();
        const runPromise = agentBotRunner.run();    // run in background
        agentBotRunner.requestStop();
        await runPromise;
        expect(spyFund).to.be.called.exactly(2);
    });

});
