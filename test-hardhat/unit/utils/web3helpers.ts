import { latestBlockTimestamp, latestBlockTimestampBN } from "../../../src/utils/web3helpers";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);

describe("web3 helper unit tests", async () => {

    it("Should return latest block timestamp as number", async () => {
        const timestamp = await latestBlockTimestamp();
        expect(typeof timestamp === 'number').to.be.true;
    });

    it("Should return latest block timestamp as BN", async() => {
        const timestampBN = await latestBlockTimestampBN();
        expect(typeof timestampBN === 'object').to.be.true;
    });

});