import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { MockChain } from "../../../src/mock/MockChain";
import { AttestationNotProved } from "../../../src/underlying-chain/interfaces/IStateConnectorClient";
import { attestationWindowSeconds } from "../../../src/utils/fasset-helpers";
import { ZERO_BYTES32, checkedCast, toBN } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { TestAssetBotContext, createTestAssetContext } from "../../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../../test-utils/hardhat-test-helpers";
use(chaiAsPromised);

const underlying1 = "UNDERLYING1";
const underlying2 = "UNDERLYING2";

describe("Attestation client unit tests", () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let chain: MockChain;

    before(async () => {
        accounts = await web3.eth.getAccounts();
    });

    describe("tests with valid prover", () => {
        async function initialize() {
            context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
            chain = checkedCast(context.blockchainIndexer.chain, MockChain);
            return { context, chain };
        }

        beforeEach(async () => {
            ({ context, chain } = await loadFixtureCopyVars(initialize));
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
            const requestConfirmedBlockHeight = await context.attestationProvider.proveConfirmedBlockHeightExists(await attestationWindowSeconds(context.assetManager));
            expect(requestConfirmedBlockHeight).to.not.be.null;
        });

        it("Should prove referenced payment nonexistence", async () => {
            chain.mine(2 * chain.finalizationBlocks);
            const requestConfirmedBlockHeight = await context.attestationProvider.proveReferencedPaymentNonexistence(underlying2, ZERO_BYTES32, toBN(1), 1, 1, 1);
            expect(requestConfirmedBlockHeight).to.not.be.null;
        });

        it("Should not request payment proof - transaction not found", async () => {
            const transaction = await context.wallet.addTransaction(underlying1, underlying2, 1, null);
            const invalidTransaction = transaction.slice(0, 50);
            await expect(context.attestationProvider.provePayment(invalidTransaction, underlying1, underlying2))
                .to.eventually.be.rejectedWith(`transaction not found ${invalidTransaction}`)
                .and.be.an.instanceOf(Error);
        });

        it("Should not request balance decreasing transaction proof - transaction not found", async () => {
            const transaction = await context.wallet.addTransaction(underlying1, underlying2, 1, null);
            const invalidTransaction = transaction.slice(0, 50);
            await expect(context.attestationProvider.requestBalanceDecreasingTransactionProof(invalidTransaction, underlying1))
                .to.eventually.be.rejectedWith(`transaction not found ${invalidTransaction}`)
                .and.be.an.instanceOf(Error);
        });

        it("Should not obtain payment proof - not finalized", async () => {
            const round = 10;
            const res = await context.attestationProvider.obtainPaymentProof(round, "");
            expect(res).to.be.equal(AttestationNotProved.NOT_FINALIZED);
        });

        it("Should wait for round finalization", async () => {
            chain.mine(chain.finalizationBlocks + 1);
            const round = 1;
            await context.attestationProvider.proveConfirmedBlockHeightExists(await attestationWindowSeconds(context.assetManager));
            const waitRound = context.attestationProvider.waitForRoundFinalization(round);
            await context.attestationProvider.proveConfirmedBlockHeightExists(await attestationWindowSeconds(context.assetManager));
            const finalized = await context.attestationProvider.roundFinalized(round);
            expect(finalized).to.be.true;
        });

        it("Should not receive referenced payment nonexistence proof - overflow block not found", async () => {
            const reference = "reference";
            const amount = 1;
            await context.wallet.addTransaction(underlying1, underlying2, amount, reference);
            const blockNumber = await context.blockchainIndexer.getBlockHeight();
            const blockTimestamp = (await context.blockchainIndexer.getBlockAt(blockNumber))?.timestamp;
            const endBlock = blockNumber + 10;
            await expect(context.attestationProvider.requestReferencedPaymentNonexistenceProof(underlying2, reference, toBN(amount), blockNumber, endBlock, blockTimestamp!))
                .to.eventually.be.rejectedWith(`overflow block not found (overflowBlock ${endBlock + 1}, endTimestamp ${blockTimestamp}, height ${blockNumber})`)
                .and.be.an.instanceOf(Error);
        });

        it("Should not find address index", async () => {
            const transaction = await context.wallet.addTransaction(underlying1, underlying2, 1, null);
            chain.mine(chain.finalizationBlocks + 1);
            await expect(context.attestationProvider.provePayment(transaction, underlying1, underlying1))
                .to.eventually.be.rejectedWith(`address ${underlying1} not used in transaction`)
                .and.be.an.instanceOf(Error);
        });
    });


    describe("tests with faulty prover", () => {
        async function initialize() {
            context = await createTestAssetContext(accounts[0], testChainInfo.xrp, undefined, undefined, undefined, true);
            chain = checkedCast(context.blockchainIndexer.chain, MockChain);
            return { context, chain };
        }

        beforeEach(async () => {
            ({ context, chain } = await loadFixtureCopyVars(initialize));
        });

        it("Should not prove payment proof", async () => {
            chain = checkedCast(context.blockchainIndexer.chain, MockChain);
            const transaction = await context.wallet.addTransaction(underlying1, underlying2, 1, null);
            chain.mine(chain.finalizationBlocks + 1);
            await expect(context.attestationProvider.provePayment(transaction, underlying1, underlying2))
                .to.eventually.be.rejectedWith(`payment: not proved`)
                .and.be.an.instanceOf(Error);
        });

        it("Should not prove balance decreasing transaction", async () => {
            chain = checkedCast(context.blockchainIndexer.chain, MockChain);
            const transaction = await context.wallet.addTransaction(underlying1, underlying2, 1, null);
            chain.mine(chain.finalizationBlocks + 1);
            await expect(context.attestationProvider.proveBalanceDecreasingTransaction(transaction, underlying1))
                .to.eventually.be.rejectedWith(`balanceDecreasingTransaction: not proved`)
                .and.be.an.instanceOf(Error);
        });

        it("Should not prove confirmed block height existence", async () => {
            chain.mine(chain.finalizationBlocks + 1);
            await expect(context.attestationProvider.proveConfirmedBlockHeightExists(await attestationWindowSeconds(context.assetManager)))
                .to.eventually.be.rejectedWith(`confirmedBlockHeightExists: not proved`)
                .and.be.an.instanceOf(Error);
        });

        it("Should not prove referenced payment nonexistence", async () => {
            chain.mine(2 * chain.finalizationBlocks);
            await expect(context.attestationProvider.proveReferencedPaymentNonexistence(underlying2, ZERO_BYTES32, toBN(1), 1, 1, 1))
                .to.eventually.be.rejectedWith(`referencedPaymentNonexistence: not proved`)
                .and.be.an.instanceOf(Error);
        });
    })
});
