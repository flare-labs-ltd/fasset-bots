import { expect } from "chai";
import * as formattingMethods from "../../../src/utils/formatting";
import { toBN } from "../../../src/utils/helpers";

describe("Formatting unit tests", () => {
    it("Should format values from array and skip array-like keys", async () => {
        const array = [toBN(0), toBN(1), null];
        const obj = { second: array };
        const event1 = { address: "address", event: "event", args: { first: array } };
        const event2 = { address: "address", event: "event", args: { first: obj, 0: obj, "1": array, __length__: 1 } };
        expect(formattingMethods.formatArgs(event1.args)).to.eq('{ first: [0, 1, null] }');
        expect(formattingMethods.formatArgs(event2.args)).to.eq('{ first: { second: [0, 1, null] } }');
        expect(formattingMethods.formatArgs(null)).to.eq("null");
    });

    it("Should format timestamp", async () => {
        expect(formattingMethods.formatTimestamp(toBN(100))).to.be.a('string');
    });

    it("Should fixed format", async () => {
        expect(formattingMethods.formatFixed(toBN(100), 0)).to.be.a('string');
    });
});
