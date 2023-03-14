// eslint-disable-next-line @typescript-eslint/no-var-requires
const chai = require('chai');
// eslint-disable-next-line @typescript-eslint/no-var-requires
chai.use(require('chai-as-promised'));
import { expect } from "chai";
import { createBlockChainHelper } from "../../../src/config/BotConfig";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { SourceId } from "../../../src/verification/sources/sources";

let blockChainHelper: BlockChainHelper;
const sourceId: SourceId = SourceId.LTC;

const txHash = "5ef8df9fa8a011c7c67321b7537e44d865e84e794d15ae6e15c1757f48e32f7b";
const blockId = 2438547;
const blockHash = "5e6260afbce873140c46cc664f492b38b64cf6b2fa491c7c7664ac5fe9742f24";
const minedTxHash = "2f9b5fe922aaaac85bc18129fea4387414190148925def8154d36a34d628f602";

describe("LTC blockchain tests", async () => {

    before(async () => {
        blockChainHelper = createBlockChainHelper(sourceId, true);
    })

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainHelper.getTransaction(txHash);
        expect(txHash).to.be.eq(retrievedTransaction?.hash);
    });

    it("Should retrieve transaction 2", async () => {
        const retrievedTransaction = await blockChainHelper.getTransaction(minedTxHash);
        expect(minedTxHash).to.be.eq(retrievedTransaction?.hash);
    });

    it("Should retrieve block (hash)", async () => {
        const retrievedBlock = await blockChainHelper.getBlock(blockHash);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should retrieve block (number)", async () => {
        const retrievedBlock = await blockChainHelper.getBlockAt(blockId);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should retrieve block height", async () => {
        const retrievedHeight = await blockChainHelper.getBlockHeight();
        expect(retrievedHeight).to.be.greaterThanOrEqual(blockId);
    });

    it("Should retrieve transaction block", async () => {
        await expect(blockChainHelper.getTransactionBlock()).to.eventually.be.rejectedWith("Method not implemented.").and.be.an.instanceOf(Error);
    });

    it("Should retrieve transaction fee", async () => {
        const fee = await blockChainHelper.getTransactionFee();
        expect(fee.toString()).to.not.be.null;
    });

});
