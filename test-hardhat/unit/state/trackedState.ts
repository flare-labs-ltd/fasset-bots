import { expect } from "chai";
import { TrackedState } from "../../../src/state/TrackedState";
import { EventArgs } from "../../../src/utils/events/common";
import { toBN } from "../../../src/utils/helpers";
import { AgentCreated, AgentDestroyed } from "../../../typechain-truffle/AssetManager";

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

    it("Should create agent", () => {
        const trackedState = new TrackedState();
        trackedState.createAgent(agentCreated);
        expect(trackedState.agents.size).to.eq(1);
    });

    it("Should destroy agent", () => {
        const trackedState = new TrackedState();
        expect(trackedState.agents.size).to.eq(0);
        trackedState.destroyAgent(agentDestroyed);
        expect(trackedState.agents.size).to.eq(0);
        trackedState.createAgent(agentCreated);
        expect(trackedState.agents.size).to.eq(1);
        trackedState.destroyAgent(agentDestroyed);
        expect(trackedState.agents.size).to.eq(0);
    });

});