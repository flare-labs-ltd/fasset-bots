import { expect } from "chai";
import * as formattingMethods from "../../../src/utils/formatting";
import { toBN } from "../../../src/utils/helpers";

describe("Formatting unit tests", async () => {

    it("Should format values from array", async () => {
        const array = [toBN(0), toBN(1), null];
        const obj = { second: array };
        const event1 = { address: "address", event: "event", args: { first: array } };
        const event2 = { address: "address", event: "event", args: { first: obj } };
        expect(formattingMethods.formatArgs(event1)).to.eq('{"first":"[0, 1, null]"}');
        expect(formattingMethods.formatArgs(event2)).to.eq('{"first":"{ second: [0, 1, null] }"}');
    });

});