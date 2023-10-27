import { expect } from "chai";
import { ORM } from "../../src/config/orm";
import { EvmEvent } from "../../src/utils/events/common";
import { AgentEntity, AgentMinting, AgentMintingState, AgentRedemption, AgentRedemptionState, DailyProofState, EventEntity } from "../../src/entities/agent";
import { overrideAndCreateOrm } from "../../src/mikro-orm.config";
import { createTestOrmOptions } from "./test-bot-config";

describe("AgentBot", () => {
    let orm: ORM;

    function createAgent(em: any): AgentEntity {
        const agent = new AgentEntity();
        agent.chainId = "0x";
        agent.chainSymbol = "symbol";
        agent.ownerAddress = "0x";
        agent.vaultAddress = "0x";
        agent.underlyingAddress = "0x";
        agent.active = true;
        agent.currentEventBlock = 0;
        agent.collateralPoolAddress = "0x";
        agent.dailyProofState = DailyProofState.OBTAINED_PROOF;
        return agent;
    }

    beforeEach(async () => {
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: "recreate", type: "sqlite" }));
    });

    it("should test agent's event handling", async () => {
        const _event = { blockNumber: 0, logIndex: 1, transactionIndex: 2 } as EvmEvent;
        const agent = createAgent(orm.em);
        orm.em.persist(agent);
        await orm.em.transactional(async (em) => {
            expect(agent.lastEventRead()).to.be.undefined;
            _event.blockNumber = 0;
            agent.addNewEvent(new EventEntity(agent, _event, false));
            _event.blockNumber = 1;
            agent.addNewEvent(new EventEntity(agent, _event, true));
            _event.blockNumber = 2;
            agent.addNewEvent(new EventEntity(agent, _event, true));
            _event.blockNumber = 3;
            agent.addNewEvent(new EventEntity(agent, _event, false));
            _event.blockNumber = 4;
            agent.addNewEvent(new EventEntity(agent, _event, true));
        });
        const unhandledEvents = agent.unhandledEvents();
        expect(unhandledEvents.length).to.equal(2);
        expect(agent.events.length).to.equal(3); // handled were deleted by agent.addEvent
        const lastEventRead = agent.lastEventRead();
        expect(lastEventRead!.blockNumber).to.equal(4);
    });
});
