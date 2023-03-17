/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as helperMethods from "../../../src/utils/helpers";
// import { fail, formatBN, isNotNull, last, multimapAdd, multimapDelete, randomAddress, reportError, requireEnv, runAsync, sleep, systemTimestamp, toBN, toHex, toNumber, toStringExp, toWei } from "../../../src/utils/helpers";
import Web3 from "web3";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chai = require('chai');
// eslint-disable-next-line @typescript-eslint/no-var-requires
chai.use(require('chai-as-promised'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const spies = require('chai-spies');
chai.use(spies);
const expect = chai.expect;

describe("Helpers unit tests", async () => {

    it("Should sleep for x seconds", async () => {
        await helperMethods.sleep(1000);
        await expect(helperMethods.sleep(1000)).to.eventually.be.fulfilled;
    });

    it("Should return system timestamp", async () => {
        const time = helperMethods.systemTimestamp();
        expect(time).to.not.be.null;
    });

    it("Should return BN", async () => {
        const expected = Web3.utils.toBN(1);
        expect(helperMethods.toBN(expected).toString()).to.eq(expected.toString());
        expect(helperMethods.toBN("" + expected).toString()).to.eq(expected.toString());
        expect(helperMethods.toBN(1).toString()).to.eq(expected.toString());
    });

    it("Should format BN", async () => {
        const number1 = 100000000000000000000;
        const expected1 = '100.0e+18';
        expect(helperMethods.formatBN(number1).toString()).to.eq(expected1);
        const number2 = 10000000000000000;
        const expected2 = '10_000_000_000_000_000';
        expect(helperMethods.formatBN(number2).toString()).to.eq(expected2);
        const number3 = '-10';
        const expected3 = '-10';
        expect(helperMethods.formatBN(number3).toString()).to.eq(expected3);
    });

    it("Should return number", async () => {
        const expected = 1;
        expect(helperMethods.toNumber(expected)).to.eq(expected);
        expect(helperMethods.toNumber("" + expected)).to.eq(expected);
        expect(helperMethods.toNumber(helperMethods.toBN(expected))).to.eq(expected);
    });

    it("Should return is null", async () => {
        expect(helperMethods.isNotNull(null)).to.be.false;
    });

    it("Should return is not null", async () => {
        expect(helperMethods.isNotNull(1)).to.be.true;
    });

    it("Should return string", async () => {
        const expected = 1;
        expect(helperMethods.toNumber(expected)).to.eq(expected);
        expect(helperMethods.toNumber("" + expected)).to.eq(expected);
        expect(helperMethods.toNumber(helperMethods.toBN(expected))).to.eq(expected);
    });

    it("Should return number", async () => {
        const expected = '1000';
        expect(helperMethods.toStringExp(1, 3)).to.eq(expected);
        expect(helperMethods.toStringExp("1", 3)).to.eq(expected);
        expect(helperMethods.toStringExp(0, 2)).to.eq(expected.slice(1));
    });

    it("Should return wei", async () => {
        const expected = helperMethods.toBN(1000000000000000000).toString();
        expect(helperMethods.toWei(1).toString()).to.eq(expected);
        expect(helperMethods.toWei("1").toString()).to.eq(expected);
    });

    it("Should return hex", async () => {
        const expected1 = "0x00000b";
        const expected2 = "0x61";
        expect(helperMethods.toHex(11, 3).toString()).to.eq(expected1);
        expect(helperMethods.toHex("a").toString()).to.eq(expected2);
    });

    it("Should return address", async () => {
        expect(helperMethods.randomAddress()).to.not.be.null;
    });

    it("Should return last element of array", async () => {
        expect(helperMethods.last([1, 2, 3])).to.eq(3);
        expect(typeof helperMethods.last([]) === 'undefined').to.be.true;
    });

    it("Should use multimapAdd and multimapDelete ", async () => {
        const map = new Map<number, Set<string>>();
        const val0 = "val0";
        const val1 = "val1";
        const val2 = "val2";
        helperMethods.multimapAdd(map, 0, val0);
        helperMethods.multimapAdd(map, 1, val1);
        helperMethods.multimapAdd(map, 0, val2);
        const set0 = map.get(0)!;
        const set1 = map.get(1)!;
        expect(set0.has(val0)).to.be.true;
        expect(set1.has(val1)).to.be.true;
        expect(map.size).to.eq(2);
        helperMethods.multimapDelete(map, 3, val0);
        expect(map.size).to.eq(2);
        helperMethods.multimapDelete(map, 0, val0);
        expect(map.size).to.eq(2);
        helperMethods.multimapDelete(map, 0, val2);
        expect(map.size).to.eq(1);
        helperMethods.multimapDelete(map, 1, val1);
        expect(map.size).to.eq(0);
    })

    it("Should use requireEnv - not defined", () => {
        const name = 'I_DO_NOT_EXIST_HA_HA';
        const fn = () => {
            return helperMethods.requireEnv(name);
        };
        expect(fn).to.throw(`Environment value ${name} not defined`);
    });

    it("Should use fail", () => {
        const errorMessage = "This is error";
        const fn1 = () => {
            return helperMethods.fail(errorMessage);
        };
        expect(fn1).to.throw(errorMessage);
        const error = new Error(errorMessage);
        const fn2 = () => {
            return helperMethods.fail(error);
        };
        expect(fn2).to.throw(error);
    });

    it("Should use reportError", () => {
        const errorMessage = "This is error";
        const spy = chai.spy.on(console, 'error');
        helperMethods.reportError(errorMessage);
        expect(spy).to.have.been.called.once;
    });

    it("Should use runAsync", () => {
        const spy = chai.spy.on(helperMethods, 'runAsync');
        helperMethods.runAsync(async () => {
            await helperMethods.sleep(1);
        })
        expect(spy).to.have.been.called.once;
    });

    it("Should use promiseValue", () => {
        const spy = chai.spy.on(helperMethods, 'promiseValue');
        helperMethods.promiseValue(helperMethods.sleep(1));
        expect(spy).to.have.been.called.once;
    });

    it("Should use objectMap", () => {
        const obj = { val0: 0, val1: 1 };
        const fn = (x: number) => x + 1;
        const obj2 = helperMethods.objectMap(obj, fn)
        expect(fn(obj.val0)).to.eq(obj2.val0);
        expect(fn(obj.val1)).to.eq(obj2.val1);
    });

    it("Should include and expect error", () => {
        const error = { message: "ERROR"};
        expect(helperMethods.errorIncluded(error, [Error])).to.be.false;
        expect(helperMethods.errorIncluded(error, ["ERROR"])).to.be.true;
        const fn = () => {
            return helperMethods.expectErrors(error, [Error]);
        };
        expect(fn).to.throw('');
    });

});