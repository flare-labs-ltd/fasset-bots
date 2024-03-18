import { expect } from "chai";
import { createBlockchainIndexerHelper, createBlockchainWalletHelper } from "../../src/config/BotConfig";
import { ORM } from "../../src/config/orm";
import { BlockchainIndexerHelper } from "../../src/underlying-chain/BlockchainIndexerHelper";
import { BlockchainWalletHelper } from "../../src/underlying-chain/BlockchainWalletHelper";
import { SourceId } from "../../src/underlying-chain/SourceId";
import { prefix0x } from "../../src/utils/helpers";
import { createTestOrm } from "../test-utils/test-bot-config";
import { removeWalletAddressFromDB } from "../test-utils/test-helpers";

let orm: ORM;
let walletHelper: BlockchainWalletHelper;
let blockChainIndexerHelper: BlockchainIndexerHelper;

export const fundedAddressXRP = "rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8";
export const fundedPrivateKeyXRP = "0058C2435FB3951ACC29F4D7396632713063F9DB3C49B320167F193CDA0E3A1622";
export const targetAddressXRP = "r4CrUeY9zcd4TpndxU5Qw9pVXfobAXFWqq";
export const targetPrivateKeyXRP = "00AF22D6EB35EFFC065BC7DBA21068DB400F1EC127A3F4A3744B676092AAF04187";

describe("XRP transaction integration tests", async () => {
    const sourceId: SourceId = SourceId.testXRP;
    const indexerUrl: string = "https://attestation-coston.aflabs.net/verifier/xrp";
    const walletUrl: string = "https://s.altnet.rippletest.net:51234";
    const amountToSendDrops = 1000000;

    before(async () => {
        orm = await createTestOrm();
        blockChainIndexerHelper = createBlockchainIndexerHelper(sourceId, indexerUrl);
        walletHelper = createBlockchainWalletHelper(sourceId, orm.em, walletUrl);
    });

    it("Should send funds and retrieve transaction", async () => {
        await walletHelper.addExistingAccount(fundedAddressXRP, fundedPrivateKeyXRP);
        const balanceBefore = await walletHelper.getBalance(targetAddressXRP);
        const options = { maxFee: 12 }; // maxFee in Drops
        const transaction = await walletHelper.addTransaction(fundedAddressXRP, targetAddressXRP, amountToSendDrops, null, options);
        const balanceAfter = await walletHelper.getBalance(targetAddressXRP);
        expect(balanceAfter.gt(balanceBefore)).to.be.true;
        // wait for transaction
        const retrievedTransaction = await blockChainIndexerHelper.waitForUnderlyingTransactionFinalization(transaction);
        expect(transaction).to.equal(retrievedTransaction?.hash);
        await removeWalletAddressFromDB(walletHelper, fundedAddressXRP);
    });

    it("Should send funds and retrieve transaction by reference", async () => {
        await walletHelper.addExistingAccount(fundedAddressXRP, fundedPrivateKeyXRP);
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        const transaction = await walletHelper.addTransaction(fundedAddressXRP, targetAddressXRP, amountToSendDrops, note, undefined);
        // wait for transaction
        const waitBlocks = 20;
        const retrievedTransaction = await blockChainIndexerHelper.waitForUnderlyingTransactionFinalization(transaction, waitBlocks);
        expect(transaction).to.equal(retrievedTransaction?.hash);
        const retrievedTransactionsByRef = await blockChainIndexerHelper.getTransactionsByReference(prefix0x(note));
        expect(retrievedTransactionsByRef.length).to.be.gt(0);
        await removeWalletAddressFromDB(walletHelper, fundedAddressXRP);
    });
});
