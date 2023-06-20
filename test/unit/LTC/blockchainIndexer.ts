import { expect } from "chai";
import { createBlockChainIndexerHelper } from "../../../src/config/BotConfig";
import { SourceId } from "../../../src/verification/sources/sources";

const sourceId: SourceId = SourceId.LTC;

describe("LTC blockchain tests via indexer", async () => {

    it("Should not create blockChainIndexerHelper - not supported chain id", async () => {
        const fn = () => {
            return createBlockChainIndexerHelper(sourceId);
        };
        expect(fn).to.throw(`SourceId ${sourceId} not supported.`);
    });

});
