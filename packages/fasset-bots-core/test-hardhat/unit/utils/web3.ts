import { initWeb3, usingGlobalWeb3 } from "../../../src/utils/web3";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);

describe("web3 unit tests", () => {
    it("Should use global web3", async () => {
        expect(usingGlobalWeb3()).to.be.true;
    });

    it("Should not initialize web3", async () => {
        await expect(initWeb3("", null, null))
            .to.eventually.be.rejectedWith("Using injected web3; initWeb3(...) has no effect.")
            .and.be.an.instanceOf(Error);
    });
});
