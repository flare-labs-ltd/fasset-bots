import { expect } from "chai";
import { initWeb3 } from "../../../src/utils/web3";
import { latestBlockTimestamp, latestBlockTimestampBN } from "../../../src/utils/web3helpers";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chai = require("chai");
// eslint-disable-next-line @typescript-eslint/no-var-requires
chai.use(require("chai-as-promised"));

describe("web3 helper unit tests", async () => {

    it("Should return latest block timestamp as number", async () => {
        const timestamp = await latestBlockTimestamp();
        expect(typeof timestamp === 'number').to.be.true;
    });

    it("Should return latest block timestamp as BN", async() => {
        const timestampBN = await latestBlockTimestampBN();
        expect(typeof timestampBN === 'object').to.be.true;
    });

    it("Should not initialize web3", async() => {
        await expect(initWeb3("", null, null)).to.eventually.be.rejectedWith("Using injected web3; initWeb3(...) has no effect.").and.be.an.instanceOf(Error);
    });

});