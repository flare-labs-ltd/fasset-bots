import { expect } from "chai";
import { ORM } from "../../src/config/orm";
import { EvmEvent } from "../../src/utils/events/common";
import { AgentEntity, DailyProofState, EventEntity } from "../../src/entities/agent";
import { overrideAndCreateOrm } from "../../src/mikro-orm.config";
import { createTestOrmOptions } from "./test-bot-config";

describe("AgentBot", () => {
    let orm: ORM;

    function createAgent(): AgentEntity {
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

    describe("event handling", () => {

        it("should store events, where the last one is handled", async () => {
            const _event = { blockNumber: 0, logIndex: 1, transactionIndex: 2 } as EvmEvent;
            const agent = createAgent();
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
                em.persist(agent);
            });
            expect(agent.events.map(e => e.blockNumber)).to.deep.equal([0, 3, 4]);
            expect(agent.unhandledEvents().map(e => e.blockNumber)).to.deep.equal([0, 3]);
            expect(agent.lastEventRead()!.blockNumber).to.equal(4);
        });

        it("should store events, where the last one is unhandled", async () => {
            const _event = { blockNumber: 0, logIndex: 1, transactionIndex: 2 } as EvmEvent;
            const agent = createAgent();
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
                agent.addNewEvent(new EventEntity(agent, _event, false));
                em.persist(agent);
            });
            expect(agent.events.map(e => e.blockNumber)).to.deep.equal([0, 3, 4]);
            expect(agent.unhandledEvents().map(e => e.blockNumber)).to.deep.equal([0, 3, 4]);
            expect(agent.lastEventRead()!.blockNumber).to.equal(4);
        });

        it("should persist data on closure", async () => {
            let agent = createAgent();
            await orm.em.transactional(async (em) => {
                expect(agent.lastEventRead()).to.be.undefined;
                agent.addNewEvent(new EventEntity(agent, {
                    blockNumber: 0, logIndex: 1, transactionIndex: 2
                } as EvmEvent, true));
                em.persist(agent);
            });
            await orm.close();
            await orm.connect();
            agent = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent.vaultAddress });
            expect(agent.lastEventRead()?.blockNumber).to.equal(0)
            expect(agent.events.map(e => e.blockNumber)).to.deep.equal([0]);
            expect(agent.unhandledEvents()).to.deep.equal([]);
        });
    });
});
