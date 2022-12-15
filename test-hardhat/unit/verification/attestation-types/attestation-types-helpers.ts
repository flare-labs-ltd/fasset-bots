import { expect } from "chai";
import { toBN } from "../../../../src/utils/helpers";
import { numberLikeToNumber, prefix0x, randomListElement, randSol, tsTypeForSolidityType, toHex } from "../../../../src/verification/attestation-types/attestation-types-helpers";

describe("Attestation types helper unit tests", async () => {

    it("Should convert solidty type to ts type", async () => {
        const expected1 = "BN";
        expect(tsTypeForSolidityType("uint8")).to.eq(expected1);
        expect(tsTypeForSolidityType("uint16")).to.eq(expected1);
        expect(tsTypeForSolidityType("uint32")).to.eq(expected1);
        expect(tsTypeForSolidityType("uint64")).to.eq(expected1);
        expect(tsTypeForSolidityType("uint128")).to.eq(expected1);
        expect(tsTypeForSolidityType("uint256")).to.eq(expected1);
        expect(tsTypeForSolidityType("int256")).to.eq(expected1);
        const expected2 = "boolean";
        expect(tsTypeForSolidityType("bool")).to.eq(expected2);
        const expected3 = "string";
        expect(tsTypeForSolidityType("string")).to.eq(expected3);
        expect(tsTypeForSolidityType("bytes4")).to.eq(expected3);
        expect(tsTypeForSolidityType("bytes32")).to.eq(expected3);
    });

    it("Should return prefixed string", async() => {
        const expected = "0x1234";
        expect(prefix0x(expected)).to.eq(expected);
        expect(prefix0x(expected.slice(2))).to.eq(expected);
    });

    it("Should return random value", async() => {
        expect(typeof randSol({}, "", "uint8") === 'object');
        expect(typeof randSol({}, "", "uint16") === 'object');
        expect(typeof randSol({}, "", "uint32") === 'object');
        expect(typeof randSol({}, "", "uint64") === 'object');
        expect(typeof randSol({}, "", "uint128") === 'object');
        expect(typeof randSol({}, "", "uint256") === 'object');
        expect(typeof randSol({}, "", "int256") === 'object');
        expect(typeof randSol({}, "", "bool") === 'object');
        expect(typeof randSol({}, "", "string") === 'object');
        expect(typeof randSol({}, "", "bytes4") === 'object');
        expect(typeof randSol({"0": 0}, "0", "bytes32") === 'object');
    });

    it("Should convert to number", async() => {
        const expected = 1;
        expect(numberLikeToNumber(expected)).to.eq(expected);
        expect(numberLikeToNumber(toBN(expected))).to.eq(expected);
        expect(numberLikeToNumber("" + expected)).to.eq(expected);
    });

    it("Should return random list element", async() => {
        const array = [1, 2, 3];
        expect(array.includes(randomListElement([1, 2, 3]))).to.be.true;
        expect(typeof randomListElement([]) === 'undefined').to.be.true;

    });

    it("Should return hex", async() => {
        const expected1 = "0x00000b";
        const expected2 = "0x61";
        expect(toHex(11, 3)).to.eq(expected1);
        expect(toHex("a")).to.eq(expected2);
    });

});