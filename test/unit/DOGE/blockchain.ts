// eslint-disable-next-line @typescript-eslint/no-var-requires
const chai = require('chai');
// eslint-disable-next-line @typescript-eslint/no-var-requires
chai.use(require('chai-as-promised'));
import { expect } from "chai";
import { createBlockChainHelper } from "../../../src/config/BotConfig";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { SourceId } from "../../../src/verification/sources/sources";

let blockChainHelper: BlockChainHelper;
const sourceId: SourceId = SourceId.DOGE;

const txHash = "8d0609d85fa234b77ccdfd5494227fc3f620e9a4c9d84e164981e70a8d7c8bc6";
const blockId = 4042116;
const blockHash = "53eb2016bb56d31874683df9f5956041cbcccd3a7c7138608bce81b7dfad317e";
const fundedAddress = "nou7f8j829FAEb4SzLz3F1N1CrMAy58ohw";
const minedTransaction = "8dff2793bb9dc1cb197d88e7c43a87480734a75aba695cb8fae517e144fb9d52";

describe("DOGE blockchain tests", async () => {

    before(async () => {
        blockChainHelper = createBlockChainHelper(sourceId, true);
    })

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainHelper.getTransaction(txHash);
        expect(txHash).to.be.eq(retrievedTransaction?.hash);
    });

    it("Should retrieve transaction 2", async () => {
        const retrievedTransaction = await blockChainHelper.getTransaction(minedTransaction);
        expect(minedTransaction).to.be.eq(retrievedTransaction?.hash);
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
        const fee = await blockChainHelper.getTransactionFee()
        expect(fee.toString()).to.not.be.null;
    });

    it("Should retrieve transaction fee", async () => {
        const fee = await blockChainHelper.getTransactionFee();
        expect(fee.toString()).to.not.be.null;
    });

});
