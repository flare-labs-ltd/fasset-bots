import { expect } from "chai";
import { AgentBot } from "../../../src/actors/AgentBot";
import { ORM } from "../../../src/config/orm";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { TrackedAgentState } from "../../../src/state/TrackedAgentState";
import { TrackedState } from "../../../src/state/TrackedState";
import { toBN } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { TestAssetBotContext, TestAssetTrackedStateContext, createTestAssetContext, getTestAssetTrackedStateContext } from "../../test-utils/create-test-asset-context";
import { createTestAgentBot, mintClass1ToOwner } from "../../test-utils/helpers";
import { AgentStatus } from "../../../src/fasset/AssetManagerTypes";

describe("Tracked agent state tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let trackedStateContext: TestAssetTrackedStateContext;
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
        trackedStateContext = getTestAssetTrackedStateContext(context);
    });

    beforeEach(async () => {
        agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const amount = toBN(10000);
        const agentCollateral = await agentBot.agent.getAgentCollateral();
        await mintClass1ToOwner(agentBot.agent.vaultAddress, amount, agentCollateral.class1.collateral!.token, ownerAddress);
        await agentBot.agent.depositClass1Collateral(amount);
        const lastBlock = await web3.eth.getBlockNumber();
        trackedState = new TrackedState(trackedStateContext, lastBlock);
        await trackedState.initialize();
        trackedAgentState = new TrackedAgentState(trackedState, agentBot.agent.vaultAddress, agentBot.agent.underlyingAddress, (await agentBot.agent.getAgentInfo()).collateralPool);
        trackedAgentState.initialize(await agentBot.agent.getAgentInfo());
    });

    it("Should return agent status", async () => {
        trackedAgentState.status = AgentStatus.DESTROYING;
        const status = trackedAgentState.possibleLiquidationTransition(toBN(0));
        expect(status.toString()).to.eq(trackedAgentState.status.toString());
    });

});