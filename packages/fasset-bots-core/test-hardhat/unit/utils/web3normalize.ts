import { expect } from "chai";
import { toBN, toBNExp } from "../../../src/utils/helpers";
import { web3DeepNormalize, web3Normalize } from "../../../src/utils/web3normalize";

describe("web3 normalize unit tests", async () => {
    it("Should normalize null to null", async () => {
        const res = web3Normalize(null);
        expect(res).to.be.null;
    });

    it("Should normalize boolean and string to boolean and string", async () => {
        expect(web3Normalize(true)).to.be.true;
        expect(web3Normalize(false)).to.be.false;
        expect(web3Normalize("")).to.eq("");
        expect(web3Normalize("random")).to.eq("random");
    });

    it("Should normalize number and bigint to string", async () => {
        expect(web3Normalize(1)).to.eq("1");
        expect(web3Normalize(BigInt(1))).to.eq("1");
    });

    it("Should normalize BN to string", async () => {
        const bn = toBNExp(10, 21);
        expect(web3Normalize(bn)).to.eq("10000000000000000000000");
    });

    it("Should throw error", async () => {
        const sym = Symbol();
        const fn1 = () => {
            return web3Normalize(sym);
        };
        const fn2 = () => {
            return web3Normalize({});
        };
        expect(fn1).to.throw("Unsupported object type");
        expect(fn2).to.throw("Unsupported object type");
    });

    it("Should deep normalize", async () => {
        const data = {
            data0: [1, 2, 3],
            data1: null,
            data2: toBN(24),
            data3: {
                a: "foo",
            },
        };
        const deepNormalize = web3DeepNormalize(data);
        expect(deepNormalize.data0[0]).to.eq(data.data0[0].toString());
        expect(deepNormalize.data1).to.eq(data.data1);
        expect(deepNormalize.data2).to.eq(data.data2.toString());
        expect(deepNormalize.data3.a).to.eq(data.data3.a);
    });

    it("Should throw error", async () => {
        const circ = { circ: {} };
        circ.circ = circ;
        const fn1 = () => {
            return web3DeepNormalize(circ);
        };
        expect(fn1).to.throw("Circular structure");

        const obj = {};
        obj.constructor = Array;
        const fn2 = () => {
            return web3DeepNormalize(obj);
        };
        expect(fn2).to.throw("Unsupported object type Array");
    });
});
