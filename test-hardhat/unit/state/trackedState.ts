import { expect } from "chai";
import { AgentB } from "../../../src/fasset-bots/AgentB";
import { TrackedState } from "../../../src/state/TrackedState";
import { EventArgs } from "../../../src/utils/events/common";
import { toBN } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { AgentCreated, AgentDestroyed } from "../../../typechain-truffle/AssetManager";
import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/test-asset-context";

const agentDestroyed = {
    '0': '0x094f7F426E4729d967216C2468DD1d44E2396e3d',
    __length__: 1,
    agentVault: '0x094f7F426E4729d967216C2468DD1d44E2396e3d'
} as EventArgs<AgentDestroyed>;

const agentCreated =  {
    '0': '0xedCdC766aA7DbB84004428ee0d35075375270E9B',
    '1': toBN(0),
    '2': '0x094f7F426E4729d967216C2468DD1d44E2396e3d',
    '3': 'UNDERLYING_ACCOUNT_78988',
    __length__: 4,
    owner: '0xedCdC766aA7DbB84004428ee0d35075375270E9B',
    agentType: toBN(0),
    agentVault: '0x094f7F426E4729d967216C2468DD1d44E2396e3d',
    underlyingAddress: 'UNDERLYING_ACCOUNT_78988'
  } as EventArgs<AgentCreated>;

describe("Tracked state tests", async () => {
    let context: TestAssetBotContext;
    let accounts:  string[];

    before(async () => {
        accounts = await web3.eth.getAccounts();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
    });

    it("Should create agent", () => {
        const trackedState = new TrackedState();
        trackedState.createAgent(agentCreated.agentVault, agentCreated.owner, agentCreated.underlyingAddress);
        expect(trackedState.agents.size).to.eq(1);
    });

    it("Should create agent with current state", async () => {
        const trackedState = new TrackedState();
        const agentB = await AgentB.create(context, accounts[0], "someAddress");
        await trackedState.createAgentWithCurrentState(agentB.vaultAddress, context);
        expect(trackedState.agents.size).to.eq(1);
    });

    it("Should destroy agent", () => {
        const trackedState = new TrackedState();
        expect(trackedState.agents.size).to.eq(0);
        trackedState.destroyAgent(agentDestroyed);
        expect(trackedState.agents.size).to.eq(0);
        trackedState.createAgent(agentCreated.agentVault, agentCreated.owner, agentCreated.underlyingAddress);
        expect(trackedState.agents.size).to.eq(1);
        trackedState.destroyAgent(agentDestroyed);
        expect(trackedState.agents.size).to.eq(0);
    });

});