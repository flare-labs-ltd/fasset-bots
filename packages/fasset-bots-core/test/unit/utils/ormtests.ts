import { ORM } from "../../../src/config/orm";
import { AgentRedemption } from "../../../src/entities/agent";
import { AgentRedemptionState } from "../../../src/entities/common";
import { toBN } from "../../../src/utils";
import { createTestOrm } from "../../test-utils/create-test-orm";

describe.skip("orm tests", () => {
    let orm: ORM;

    beforeEach(async () => {
        orm = await createTestOrm();
    });

    it("test orm", async () => {
        const query = orm.em.createQueryBuilder(AgentRedemption, "redemption")
            .where({ agentAddress: "0x123456678" })
            .andWhere({ lastUnderlyingBlock: { $lt: toBN(200) } })
            .andWhere({ lastUnderlyingTimestamp: { $lt: toBN(300) } })
            .andWhere({ $not: { state: AgentRedemptionState.STARTED } })
            .andWhere({ $not: { state: AgentRedemptionState.DONE } })
            .limit(10);
        console.log(query.getQuery(), query.getParams());
    });

    it("test orm 2", async () => {
        const query = orm.em.createQueryBuilder(AgentRedemption, "redemption")
            .where({
                agentAddress: "0x123456678",
                lastUnderlyingBlock: { $lt: toBN(200) },
                lastUnderlyingTimestamp: { $lt: toBN(300) },
                state: { $nin: [AgentRedemptionState.STARTED, AgentRedemptionState.DONE] }
            })
            .limit(10);
        console.log(query.getQuery(), query.getParams());
    });
});
