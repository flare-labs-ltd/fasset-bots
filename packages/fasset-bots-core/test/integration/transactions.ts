import { expect } from "chai";
import { Secrets, indexerApiKey } from "../../src/config";
import { createBlockchainIndexerHelper, createBlockchainWalletHelper } from "../../src/config/BotConfig";
import { ORM } from "../../src/config/orm";
import { BlockchainIndexerHelper } from "../../src/underlying-chain/BlockchainIndexerHelper";
import { BlockchainWalletHelper } from "../../src/underlying-chain/BlockchainWalletHelper";
import { ChainId } from "../../src/underlying-chain/ChainId";
import { prefix0x } from "../../src/utils/helpers";
import { createTestOrm } from "../test-utils/create-test-orm";
import { TEST_SECRETS } from "../test-utils/test-bot-config";
import { removeWalletAddressFromDB } from "../test-utils/test-helpers";
import { TransactionStatus } from "@flarelabs/simple-wallet";

let orm: ORM;
let walletHelper: BlockchainWalletHelper;
let blockChainIndexerHelper: BlockchainIndexerHelper;

export const fundedAddressXRP = "rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8";
export const fundedPrivateKeyXRP = "0058C2435FB3951ACC29F4D7396632713063F9DB3C49B320167F193CDA0E3A1622";
export const targetAddressXRP = "r4CrUeY9zcd4TpndxU5Qw9pVXfobAXFWqq";
export const targetPrivateKeyXRP = "00AF22D6EB35EFFC065BC7DBA21068DB400F1EC127A3F4A3744B676092AAF04187";

describe("XRP transaction integration tests", () => {
    let secrets: Secrets;
    const chainId: ChainId = ChainId.testXRP;
    const indexerUrls: string[] = ["https://attestation-coston.aflabs.net/verifier/xrp"];
    const walletUrls: string[] = ["https://s.altnet.rippletest.net:51234"];
    const amountToSendDrops = 1000000;

    before(async () => {
        secrets = await Secrets.load(TEST_SECRETS);
        orm = await createTestOrm();
        blockChainIndexerHelper = createBlockchainIndexerHelper(chainId, indexerUrls, indexerApiKey(secrets));
        walletHelper = await createBlockchainWalletHelper(secrets, chainId, orm.em, walletUrls);
        void walletHelper.walletClient.startMonitoringTransactionProgress();
    });

    after(async () => {
        await walletHelper.walletClient.stopMonitoring();
    });

    it("Should send funds and retrieve transaction", async () => {
        await walletHelper.addExistingAccount(fundedAddressXRP, fundedPrivateKeyXRP);
        const balanceBefore = await walletHelper.getBalance(targetAddressXRP);
        const options = { maxFee: 12 }; // maxFee in Drops
        const dbId = await walletHelper.addTransaction(fundedAddressXRP, targetAddressXRP, amountToSendDrops, null, options);
        while(1) {
            const info = await walletHelper.walletClient.getTransactionInfo(dbId);
            if (info.status == TransactionStatus.TX_SUCCESS) break;
            if (info.status == TransactionStatus.TX_FAILED) throw new Error("Test failed");
        }
        const txInfo = await walletHelper.walletClient.getTransactionInfo(dbId);
        const balanceAfter = await walletHelper.getBalance(targetAddressXRP);
        expect(balanceAfter.gt(balanceBefore)).to.be.true;
        // wait for transaction
        const retrievedTransaction = await blockChainIndexerHelper.waitForUnderlyingTransactionFinalization(txInfo.transactionHash!);
        expect(txInfo.transactionHash).to.equal(retrievedTransaction?.hash);
        await removeWalletAddressFromDB(walletHelper, fundedAddressXRP);
    });

    it("Should send funds and retrieve transaction by reference", async () => {
        await walletHelper.addExistingAccount(fundedAddressXRP, fundedPrivateKeyXRP);
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        const dbId = await walletHelper.addTransaction(fundedAddressXRP, targetAddressXRP, amountToSendDrops, note, undefined);
        const startTime = Date.now();
        const maxDuration = 1.5 * 60 * 1000;
        while(1) {
            const elapsedTime = Date.now() - startTime;
            const info = await walletHelper.walletClient.getTransactionInfo(dbId);
            if (info.status == TransactionStatus.TX_SUCCESS) break;
            if (info.status == TransactionStatus.TX_FAILED) throw new Error("Test failed");
            if (elapsedTime > maxDuration) throw new Error("Test failed");
        }
        const txInfo = await walletHelper.walletClient.getTransactionInfo(dbId);
        // wait for transaction
        const waitBlocks = 20;
        const retrievedTransaction = await blockChainIndexerHelper.waitForUnderlyingTransactionFinalization(txInfo.transactionHash!, waitBlocks);
        expect(txInfo.transactionHash!).to.equal(retrievedTransaction?.hash);
        const retrievedTransactionsByRef = await blockChainIndexerHelper.getTransactionsByReference(prefix0x(note));
        expect(retrievedTransactionsByRef.length).to.be.gt(0);
        await removeWalletAddressFromDB(walletHelper, fundedAddressXRP);
    });
});
