import { expect } from "chai";
import { eventOrder } from "../../../../src/utils/events/common";

describe("Common unit tests",  () => {
    const event1 = {
        blockNumber: 1,
        transactionIndex: 1,
        logIndex: 1,
    };
    const event2 = {
        blockNumber: 1,
        transactionIndex: 2,
        logIndex: 1,
    };
    const event3 = {
        blockNumber: 3,
        transactionIndex: 2,
        logIndex: 1,
    };
    const event4 = {
        blockNumber: 1,
        transactionIndex: 1,
        logIndex: 2,
    };
    it("Should order events", async () => {
        const order1 = eventOrder(event2, event1);
        expect(order1).to.eq(1);
        const order2 = eventOrder(event3, event1);
        expect(order2).to.eq(2);
        const order3 = eventOrder(event4, event1);
        expect(order3).to.eq(1);
    });
});
