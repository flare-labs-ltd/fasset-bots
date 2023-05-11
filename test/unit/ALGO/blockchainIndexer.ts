import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);
import { SourceId } from "../../../src/verification/sources/sources";
import rewire from "rewire";
const rewiredBlockChainIndexerHelper = rewire("../../../src/underlying-chain/BlockChainIndexerHelper");
const rewiredBlockChainIndexerHelperClass = rewiredBlockChainIndexerHelper.__get__("BlockChainIndexerHelper");

const sourceId: SourceId = SourceId.ALGO;

describe("ALGO blockchain tests via indexer", async () => {
    //TODO - no indexer yet
    let rewiredBlockChainIndexerClient: typeof rewiredBlockChainIndexerHelperClass;

    before(async () => {
        rewiredBlockChainIndexerClient = new rewiredBlockChainIndexerHelperClass("", sourceId, "");
    })

    it("Should not return inputs/outputs - not implemented", async () => {
        await expect(rewiredBlockChainIndexerClient.handleInputsOutputs({ transactionType: "payment", response: { data: {} } }, false)).to.eventually.be.rejectedWith(`Method not implemented. No indexer for ALGO yet.`).and.be.an.instanceOf(Error);
    });

});

