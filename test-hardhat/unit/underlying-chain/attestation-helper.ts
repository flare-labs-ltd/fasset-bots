import { MockChain } from "../../../src/mock/MockChain";
import { checkedCast, toBN } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestAssetContext, TestAssetBotContext } from "../../utils/test-asset-context";
import { testChainInfo } from "../../../test/utils/TestChainInfo";
import { expect } from "chai";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chai = require("chai");
// eslint-disable-next-line @typescript-eslint/no-var-requires
chai.use(require("chai-as-promised"));

const underlying1 = "UNDERLYING1";
const underlying2 = "UNDERLYING2";

describe("Attestation client unit tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let chain: MockChain;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.chain, MockChain);
    });

    beforeEach(async () => {
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.chain, MockChain);
    });

    it("Should return round finalization", async () => {
        const round = 1;
        const finalized = await context.attestationProvider.roundFinalized(round);
        expect(finalized).to.be.false;
    });

    it("Should prove payment proof", async () => {
        const transaction = await context.wallet.addTransaction(underlying1, underlying2, 1, null);
        chain.mine(chain.finalizationBlocks + 1);
        const provePayment = await context.attestationProvider.provePayment(transaction, underlying1, underlying2);
        expect(provePayment).to.not.be.null;
    });

    it("Should prove balance decreasing transaction proof", async () => {
        const transaction = await context.wallet.addTransaction(underlying1, underlying2, 1, null);
        chain.mine(chain.finalizationBlocks + 1);
        const proveBalanceDecreasingTransaction = await context.attestationProvider.proveBalanceDecreasingTransaction(transaction, underlying1);
        expect(proveBalanceDecreasingTransaction).to.not.be.null;
    });

    it("Should prove confirmed block height existence", async () => {
        chain.mine(chain.finalizationBlocks + 1);
        const requestConfirmedBlockHeight = await context.attestationProvider.proveConfirmedBlockHeightExists();
        expect(requestConfirmedBlockHeight).to.not.be.null;
    });

    it("Should prove referenced payment nonexistence", async () => {
        chain.mine(2 * chain.finalizationBlocks);
        const requestConfirmedBlockHeight = await context.attestationProvider.proveReferencedPaymentNonexistence(underlying2, "", toBN(1), 1, 1);
        expect(requestConfirmedBlockHeight).to.not.be.null;
    });

    it("Should not request payment proof - transaction not found", async () => {
        const transaction = await context.wallet.addTransaction(underlying1, underlying2, 1, null);
        const invalidTransaction = transaction.slice(0, 50);
        await expect(context.attestationProvider.provePayment(invalidTransaction, underlying1, underlying2)).to.eventually.be.rejectedWith(`transaction not found ${invalidTransaction}`).and.be.an.instanceOf(Error);
    });

    it("Should not request balance decreasing transaction proof - transaction not found", async () => {
        const transaction = await context.wallet.addTransaction(underlying1, underlying2, 1, null);
        const invalidTransaction = transaction.slice(0, 50);
        await expect(context.attestationProvider.requestBalanceDecreasingTransactionProof(invalidTransaction, underlying1)).to.eventually.be.rejectedWith(`transaction not found ${invalidTransaction}`).and.be.an.instanceOf(Error);
    });

    it("Should not request payment proof - finalization block not found", async () => {
        const transaction = await context.wallet.addTransaction(underlying1, underlying2, 1, null);
        const blockNumber = (await chain.getTransactionBlock(transaction))?.number;
        const blockHeight = await chain.getBlockHeight();
        chain.finalizationBlocks = 10;
        await expect(context.attestationProvider.provePayment(transaction, underlying1, underlying2)).to.eventually.be.rejectedWith(`finalization block not found (block ${blockNumber}, height ${blockHeight})`).and.be.an.instanceOf(Error);
    });

    it("Should not request balance decreasing transaction proof - finalization block not found", async () => {
        const transaction = await context.wallet.addTransaction(underlying1, underlying2, 1, null);
        const blockNumber = (await chain.getTransactionBlock(transaction))?.number;
        const blockHeight = await chain.getBlockHeight();
        chain.finalizationBlocks = 10;
        await expect(context.attestationProvider.requestBalanceDecreasingTransactionProof(transaction, underlying1)).to.eventually.be.rejectedWith(`finalization block not found (block ${blockNumber}, height ${blockHeight})`).and.be.an.instanceOf(Error);
    });

    it("Should not obtain payment proof - finalization block not found", async () => {
        const round = 10;
        await expect(context.attestationProvider.obtainVerifiedPaymentProof(round, "")).to.eventually.be.rejectedWith(`payment: not proved`).and.be.an.instanceOf(Error);
    });

    it("Should not obtain balance decreasing transaction proof - finalization block not found", async () => {
        const round = 10;
        await expect(context.attestationProvider.obtainVerifiedBalanceDecreasingTransactionProof(round, "")).to.eventually.be.rejectedWith(`balanceDecreasingTransaction: not proved`).and.be.an.instanceOf(Error);
    });

    it("Should not obtain verified referenced payment nonexistence proof - finalization block not found", async () => {
        const round = 10;
        await expect(context.attestationProvider.obtainVerifiedReferencedPaymentNonexistenceProof(round, "")).to.eventually.be.rejectedWith(`referencedPaymentNonexistence: not proved`).and.be.an.instanceOf(Error);
    });

    it("Should not obtain verified confirmed Block height exists proof - finalization block not found", async () => {
        const round = 10;
        await expect(context.attestationProvider.obtainVerifiedConfirmedBlockHeightExistsProof(round, "")).to.eventually.be.rejectedWith(`confirmedBlockHeightExists: not proved`).and.be.an.instanceOf(Error);
    });

    it("Should wait for round finalization", async () => {
        chain.mine(chain.finalizationBlocks + 1);
        const round = 1;
        await context.attestationProvider.proveConfirmedBlockHeightExists();
        const waitRound = context.attestationProvider.waitForRoundFinalization(round);
        await context.attestationProvider.proveConfirmedBlockHeightExists();
        const finalized = await context.attestationProvider.roundFinalized(round);
        expect(finalized).to.be.true;
    })

    it("Should not receive referenced payment nonexistence proof - overflow block not found", async () => {
        const reference = "reference";
        const amount = 1;
        await context.wallet.addTransaction(underlying1, underlying2, amount, reference);
        const blockNumber = await context.chain.getBlockHeight();
        const blockTimestamp = (await context.chain.getBlockAt(blockNumber))?.timestamp;
        const endBlock = blockNumber + 10;
        await expect(context.attestationProvider.requestReferencedPaymentNonexistenceProof(underlying2, reference, toBN(amount), endBlock, blockTimestamp!))
            .to.eventually.be.rejectedWith(`overflow block not found (overflowBlock ${endBlock + 1}, endTimestamp ${blockTimestamp}, height ${blockNumber})`).and.be.an.instanceOf(Error);
    });

    it("Should not receive referenced payment nonexistence proof - finalization block not found", async () => {
        chain.finalizationBlocks = 10;
        const reference = "reference";
        const amount = 1;
        await context.wallet.addTransaction(underlying1, underlying2, amount, reference);
        const blockNumber = await context.chain.getBlockHeight();
        const blockTimestamp = (await context.chain.getBlockAt(blockNumber))?.timestamp;
        const endBlockNumber = blockNumber;
        const endBlockTimestamp = blockTimestamp! + 10;
        chain.mine(3);
        const overflowBlock = await context.chain.getBlockAt(endBlockNumber + 1);
        const blockHeight = await context.chain.getBlockHeight();
        await expect(context.attestationProvider.requestReferencedPaymentNonexistenceProof(underlying2, reference, toBN(amount), endBlockNumber, endBlockTimestamp!))
            .to.eventually.be.rejectedWith(`finalization block not found (block ${overflowBlock!.number + 1}, height ${blockHeight})`).and.be.an.instanceOf(Error);
    });

});