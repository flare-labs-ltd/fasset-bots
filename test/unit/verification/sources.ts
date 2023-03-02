import { expect } from "chai";
import { getSourceName, SourceId, toSourceId } from "../../../src/verification/sources/sources";
const chai = require('chai');
chai.use(require('chai-as-promised'));

const sourceBTC = SourceId.BTC;
const sourceNameBTC = "BTC";

describe("Sources tests", async () => {

    it("Should return source name", async () => {
        const returnedSourceNameBTC = getSourceName(sourceBTC);
        expect(returnedSourceNameBTC).to.equal(sourceNameBTC);
    });

    it("Should not return source name, invalid sourceId", async () => {
        const source100 = 10000;
        const returnedNullSourceName = getSourceName(source100);
        expect(returnedNullSourceName).to.be.null;
    });

    it("Should return sourceId", async () => {
        const returnedToSourceId1 = toSourceId(sourceBTC);
        expect(returnedToSourceId1).to.equal(sourceBTC);

        const returnedToSourceId2 = toSourceId("BTC");
        expect(returnedToSourceId2).to.equal(sourceBTC);

        const returnedToSourceId3 = toSourceId("BTC_BTC");
        expect(returnedToSourceId3).to.equal(SourceId.invalid);
    });

});
