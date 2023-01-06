import { formatBN, isNotNull, last, randomAddress, sleep, systemTimestamp, toBN, toHex, toNumber, toStringExp, toWei } from "../../../src/utils/helpers";
import Web3 from "web3";
import { expect } from "chai";
const chai = require('chai');
chai.use(require('chai-as-promised'));

describe("Helpers unit tests", async () => {

    it("Should sleep for x seconds", async () => {
        await sleep(1000);
        await expect(sleep(1000)).to.eventually.be.fulfilled;
    });
    
    it("Should return system timestamp", async () => {
        const time = systemTimestamp();
        expect(time).to.not.be.null;
    });

    it("Should return BN", async() => {
        const expected = Web3.utils.toBN(1);
        expect(toBN(expected).toString()).to.eq(expected.toString());
        expect(toBN("" + expected).toString()).to.eq(expected.toString());
        expect(toBN(1).toString()).to.eq(expected.toString());
    });

    it("Should format BN", async() => {
        const number1 = 100000000000000000000;
        const expected1 = '100.0e+18';
        expect(formatBN(number1).toString()).to.eq(expected1);
        const number2 = 10000000000000000;
        const expected2 = '10_000_000_000_000_000';
        expect(formatBN(number2).toString()).to.eq(expected2);
    });

    it("Should return number", async() => {
        const expected = 1;
        expect(toNumber(expected)).to.eq(expected);
        expect(toNumber("" + expected)).to.eq(expected);
        expect(toNumber(toBN(expected))).to.eq(expected);
    });

    it("Should return is null", async() => {
        expect(isNotNull(null)).to.be.false;
    });

    it("Should return is not null", async() => {
        expect(isNotNull(1)).to.be.true;
    });

    it("Should return string", async() => {
        const expected = 1;
        expect(toNumber(expected)).to.eq(expected);
        expect(toNumber("" + expected)).to.eq(expected);
        expect(toNumber(toBN(expected))).to.eq(expected);
    });

    it("Should return number", async() => {
        const expected = '1000';
        expect(toStringExp(1, 3)).to.eq(expected);
        expect(toStringExp("1", 3)).to.eq(expected);
        expect(toStringExp(0, 2)).to.eq(expected.slice(1));
    });

    it("Should return wei", async() => {
        const expected = toBN(1000000000000000000).toString();
        expect(toWei(1).toString()).to.eq(expected);
        expect(toWei("1").toString()).to.eq(expected);
    });

    it("Should return hex", async() => {
        const expected1 = "0x00000b";
        const expected2 = "0x61";
        expect(toHex(11, 3).toString()).to.eq(expected1);
        expect(toHex("a").toString()).to.eq(expected2);
    });

    it("Should return address", async() => {
        expect(randomAddress()).to.not.be.null;
    });
    
    it("Should return last element of array", async() => {
        expect(last([1, 2, 3])).to.eq(3);
        expect(typeof last([]) === 'undefined').to.be.true;
    });
});