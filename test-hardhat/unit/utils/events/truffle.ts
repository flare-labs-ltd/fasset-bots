import { expect } from "chai";
import { findRequiredEvent, eventArgs } from "../../../../src/utils/events/truffle";

describe("Truffle unit tests", async () => {
    const response = {
        tx: "0xae28bac67c4e9d96228c7d5076007d9b3184f9645023b48b5a196cb1c2bd5dd0",
        receipt: {
            transactionHash: "0xae28bac67c4e9d96228c7d5076007d9b3184f9645023b48b5a196cb1c2bd5dd0",
            transactionIndex: 0,
            blockHash: "0xaeec060dc3fb76ae5ad1a77be3d96175f7e2bf90324d08385de6c06359075c26",
            blockNumber: 62,
            from: "0x92561f28ec438ee9831d00d1d59fbdc981b762b2",
            to: "0x0d8448c0fbb84c30395838c8b3fd64722ea94532",
            cumulativeGasUsed: 6689176,
            gasUsed: 6689176,
            contractAddress: null,
            logs: [[Object]],
            logsBloom:
                "0x00000000000000000000040000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000808000000000000000400000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000020000000000000000000000000000000000000",
            type: "0x2",
            status: true,
            effectiveGasPrice: 2500304229,
            rawLogs: [[Object]],
        },
        logs: [
            {
                removed: false,
                logIndex: 0,
                transactionIndex: 0,
                transactionHash: "0xae28bac67c4e9d96228c7d5076007d9b3184f9645023b48b5a196cb1c2bd5dd0",
                blockHash: "0xaeec060dc3fb76ae5ad1a77be3d96175f7e2bf90324d08385de6c06359075c26",
                blockNumber: 62,
                address: "0x0D8448C0fBB84c30395838C8b3fD64722ea94532",
                id: "log_35371824",
                event: "AgentVaultCreated",
                args: [],
                type: "event",
            },
        ],
    };
    const eventName = "someEvent";

    it("Should throw missing event", async () => {
        const eventName = "someEvent";
        const fn = () => {
            return findRequiredEvent(response, eventName);
        };
        expect(fn).to.throw(`Missing event ${eventName}`);
    });

    it("Should get event arguments", async () => {
        expect(eventArgs(response, eventName)).to.be.undefined;
        expect(eventArgs(response, "AgentVaultCreated").length).to.eq(0);
    });
});
