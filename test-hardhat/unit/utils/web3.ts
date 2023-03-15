import { expect } from "chai";
import { initWeb3, usingGlobalWeb3 } from "../../../src/utils/web3";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chai = require("chai");
// eslint-disable-next-line @typescript-eslint/no-var-requires
chai.use(require("chai-as-promised"));

describe("web3 unit tests", async () => {

    it("Should use global web3", async() => {
        expect(usingGlobalWeb3()).to.be.true;
    });

    it("Should not initialize web3", async() => {
        await expect(initWeb3("", null, null)).to.eventually.be.rejectedWith("Using injected web3; initWeb3(...) has no effect.").and.be.an.instanceOf(Error);
    });

});