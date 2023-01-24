import { expect } from "chai";
import { toBN } from "../../../../src/utils/helpers";
import { NumberLike, SupportedSolidityType } from "../../../../src/verification/attestation-types/attestation-types";
import { numberLikeToNumber, prefix0x, randomListElement, randSol, tsTypeForSolidityType, toHex, hexlifyBN } from "../../../../src/verification/attestation-types/attestation-types-helpers";

describe("Attestation types helper unit tests", () => {

    it("Should convert solidty type to ts type", () => {
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
        const expected4 = undefined;
        expect(tsTypeForSolidityType("bytes3" as SupportedSolidityType)).to.eq(expected4);
    });

    it("Should return prefixed string", () => {
        const expected = "0x1234";
        expect(prefix0x(expected)).to.eq(expected);
        expect(prefix0x(expected.slice(2))).to.eq(expected);
    });

    it("Should return random value", () => {
        const expected = 'object';
        expect(typeof randSol({}, "", "uint8") === expected);
        expect(typeof randSol({}, "", "uint16") === expected);
        expect(typeof randSol({}, "", "uint32") === expected);
        expect(typeof randSol({}, "", "uint64") === expected);
        expect(typeof randSol({}, "", "uint128") === expected);
        expect(typeof randSol({}, "", "uint256") === expected);
        expect(typeof randSol({}, "", "int256") === expected);
        expect(typeof randSol({}, "", "bool") === expected);
        expect(typeof randSol({}, "", "string") === expected);
        expect(typeof randSol({}, "", "bytes4") === expected);
        expect(typeof randSol({}, "", "bytes32") === expected);
        expect(typeof randSol({ "0": 1 }, "0", "bytes32") === expected);
        const expected2 = undefined;
        expect(typeof randSol({}, "", "bytes3" as SupportedSolidityType) === expected2);
    });

    it("Should convert to number", () => {
        const expected = 1;
        expect(numberLikeToNumber(expected)).to.eq(expected);
        expect(numberLikeToNumber(toBN(expected))).to.eq(expected);
        expect(numberLikeToNumber("" + expected)).to.eq(expected);
        const expected2 = undefined;
        expect(numberLikeToNumber(undefined as unknown as NumberLike)).to.eq(expected2);
        expect(numberLikeToNumber(null as unknown as NumberLike)).to.eq(expected2);
    });

    it("Should return random list element", () => {
        const array = [1, 2, 3];
        expect(array.includes(randomListElement([1, 2, 3]))).to.be.true;
        expect(typeof randomListElement([]) === 'undefined').to.be.true;

    });

    it("Should return hex", () => {
        const expected1 = "0x00000b";
        const expected2 = "0x61";
        expect(toHex(11, 3)).to.eq(expected1);
        expect(toHex("a")).to.eq(expected2);
    });

    it("Should hexlify", () => {
        const string = "5795a1e56931bB7Fb8389821f3574983502A785d";
        expect(hexlifyBN(string)).to.eq("0x" + string);
        expect(hexlifyBN("0x" + string)).to.eq("0x" + string);
        const array = [string]
        expect(hexlifyBN(array)[0]).to.eq("0x" + string);
        const num = 111;
        expect(hexlifyBN(num)).to.eq(num);
        expect(hexlifyBN(toBN(num))).to.eq("0x6f");
        const obj = { "string": string, "num": num};
        expect(hexlifyBN(obj).string).to.eq("0x" + string);
        expect(hexlifyBN(obj).num).to.eq(num);
    })

});