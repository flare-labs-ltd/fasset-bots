import { expect } from "chai";
import { AgentBot, AgentStatus } from "../../../src/actors/AgentBot";
import { ORM } from "../../../src/config/orm";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { TrackedAgentState } from "../../../src/state/TrackedAgentState";
import { TrackedState } from "../../../src/state/TrackedState";
import { MAX_UINT256, toBN } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { TestAssetBotContext, createTestAssetContext } from "../../test-utils/test-asset-context";
import { createAgentBot, mintClass1ToOwner } from "../../test-utils/helpers";

describe("Tracked agent state tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let agentBot: AgentBot;
    let trackedAgentState: TrackedAgentState;
    let trackedState: TrackedState;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        ownerAddress = accounts[3];
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
    });

    beforeEach(async () => {
        agentBot = await createAgentBot(context, orm, ownerAddress);
        const amount = toBN(10000);
        await mintClass1ToOwner(agentBot.agent.vaultAddress, amount, agentBot.agent.agentSettings.class1CollateralToken, ownerAddress);
        await agentBot.agent.depositClass1Collateral(amount);
        const lastBlock = await web3.eth.getBlockNumber();
        trackedState = new TrackedState(context, lastBlock);
        await trackedState.initialize();
        trackedAgentState = new TrackedAgentState(trackedState, agentBot.agent.vaultAddress, agentBot.agent.underlyingAddress);
        trackedAgentState.initialize(await agentBot.agent.getAgentInfo());
    });

    it("Should return collateral ratio", async () => {
        const cr = await trackedAgentState.collateralRatioBIPS();
        expect(cr.toString()).to.eq(MAX_UINT256.toString());
    });

    it("Should return agent status", async () => {
        trackedAgentState.status = AgentStatus.DESTROYING;
        const status = await trackedAgentState.possibleLiquidationTransition(toBN(0));
        expect(status.toString()).to.eq(trackedAgentState.status.toString());
    });

});