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

const txHash = "28872e7d2268343c96d80c56962c9650a6796119835136be9f002215f438dca6";
const blockId = 2538180;
const blockHash = "257edc6d99359f37ca84fb5edabd9c4651f5db852555243ac48fbedfcc3aecf6";
const fundedAddress = "mzM88w7CdxrFyzE8RKZmDmgYQgT5YPdA6S";

describe("LTC blockchain tests", async () => {

    before(async () => {
        blockChainHelper = createBlockChainHelper(sourceId, true);
    })

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainHelper.getTransaction(txHash);
        expect(txHash).to.be.eq(retrievedTransaction?.hash);
    });

    it("Should retrieve balance", async () => {
        const balance = await blockChainHelper.getBalance(fundedAddress);
        expect(balance.gten(0)).to.be.true;
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
