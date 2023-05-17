import * as helperMethods from "../../../src/utils/helpers";
import Web3 from "web3";
import spies from "chai-spies";
import chaiAsPromised from "chai-as-promised";
import { expect, spy, use } from "chai";
import { toBN } from "../../../src/utils/helpers";
use(chaiAsPromised);
use(spies);

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

    it("Should return number", async () => {
        const expected = 1;
        expect(helperMethods.toNumber(expected)).to.eq(expected);
        expect(helperMethods.toNumber("" + expected)).to.eq(expected);
        expect(helperMethods.toNumber(helperMethods.toBN(expected))).to.eq(expected);
    });

    it("Should require not null variable", async () => {
        const errorMessage = "Should not be null";
        expect(helperMethods.requireNotNull(1, errorMessage)).to.eq(1);
        const fn = () => {
            return helperMethods.requireNotNull(null, errorMessage);
        };
        expect(fn).to.throw(errorMessage);
        const fn2 = () => {
            return helperMethods.requireNotNull(null);
        };
        expect(fn2).to.throw("Value is null or undefined");
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

    it("Should return hex", async () => {
        const expected1 = "0x00000b";
        const expected2 = "0x61";
        expect(helperMethods.toHex(11, 3).toString()).to.eq(expected1);
        expect(helperMethods.toHex("a").toString()).to.eq(expected2);
    });

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
        const spyError = spy.on(console, 'error');
        helperMethods.reportError(errorMessage);
        expect(spyError).to.have.been.called.once;
    });

    it("Should include and expect error", () => {
        const error = { message: "ERROR" };
        expect(helperMethods.errorIncluded(error, [Error])).to.be.false;
        expect(helperMethods.errorIncluded(error, ["ERROR"])).to.be.true;
        const fn = () => {
            return helperMethods.expectErrors(error, [Error]);
        };
        expect(fn).to.throw('');
    });

    it("Should return maximal BN", () => {
        const a = toBN(1);
        const b = toBN(2);
        expect(helperMethods.maxBN(a, b).toString()).to.eq(b.toString());
    });

});