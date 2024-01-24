import { assert } from "chai";
import { toBN } from "../../../src/utils";
import { formatFixed } from "../../../src/utils/formatting";

describe("formatting unit tests", async () => {
    it("formatFixed should work properly - 18 decimals", () => {
        const value = toBN("12345678912345678000000000");
        // default decimals
        assert.equal(formatFixed(value, 18), "12345678.912345678")
        assert.equal(formatFixed(value, 18, { padRight: true }), "12345678.912345678000000000")
        assert.equal(formatFixed(value, 18, { groupDigits: true }), "12_345_678.912345678")
        assert.equal(formatFixed(value, 18, { groupDigits: true, groupSeparator: " " }), "12 345 678.912345678")
        // 3 decimals
        assert.equal(formatFixed(value, 18, { decimals: 3 }), "12345678.912")
        assert.equal(formatFixed(value, 18, { decimals: 3, padRight: true }), "12345678.912")
        assert.equal(formatFixed(value, 18, { decimals: 3, groupDigits: true }), "12_345_678.912")
        assert.equal(formatFixed(value, 18, { decimals: 3, padRight: true, groupDigits: true, groupSeparator: " " }), "12 345 678.912")
        // 6 decimals
        assert.equal(formatFixed(value, 18, { decimals: 6 }), "12345678.912346")
        assert.equal(formatFixed(value, 18, { decimals: 6, padRight: true }), "12345678.912346")
        assert.equal(formatFixed(value, 18, { decimals: 6, groupDigits: true }), "12_345_678.912346")
        assert.equal(formatFixed(value, 18, { decimals: 6, padRight: true, groupDigits: true, groupSeparator: " " }), "12 345 678.912346")
        // 12 decimals
        assert.equal(formatFixed(value, 18, { decimals: 12 }), "12345678.912345678")
        assert.equal(formatFixed(value, 18, { decimals: 12, padRight: true }), "12345678.912345678000")
        assert.equal(formatFixed(value, 18, { decimals: 12, groupDigits: true }), "12_345_678.912345678")
        assert.equal(formatFixed(value, 18, { decimals: 12, padRight: true, groupDigits: true, groupSeparator: " " }), "12 345 678.912345678000")
    });
});
