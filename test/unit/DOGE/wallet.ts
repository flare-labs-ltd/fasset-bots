import { expect } from "chai";
import { ORM } from "../../../src/config/orm";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { BlockChainWalletHelper } from "../../../src/underlying-chain/BlockChainWalletHelper";
import { DBWalletKeys } from "../../../src/underlying-chain/WalletKeys";
import { SourceId } from "../../../src/verification/sources/sources";
import { createTestOrm } from "../../test.mikro-orm.config";
import { createTestBlockChainHelper, createTestBlockChainWalletHelper } from "../../utils/test-bot-config";

let orm: ORM;
let dbWallet: DBWalletKeys;
let walletHelper: BlockChainWalletHelper;
let blockChainHelper: BlockChainHelper;
const sourceId: SourceId = SourceId.DOGE;

const fundedAddress = "nou7f8j829FAEb4SzLz3F1N1CrMAy58ohw";
const fundedPrivateKey = "cfHf9MCiZbPidE1XXxCCBnzwJSKRtvpfoZrY6wFvy17HmKbBqt1j";
const targetAddress = "nk1Uc5w6MHC1DgtRvnoQvCj3YgPemzha7D";
const targetPrivateKey = "ckmubApfH515MCZNC9ufLR4kHrmnb1PCtX2vhoN4iYx9Wqzh2AQ9";

const amountToSendDOGE = 1;

describe("DOGE wallet tests", async () => {

    before(async () => {
        orm = await createTestOrm();
        dbWallet = new DBWalletKeys(orm.em);
        blockChainHelper = createTestBlockChainHelper(sourceId);
        walletHelper = createTestBlockChainWalletHelper(sourceId, orm.em);
    })

    it("Should insert address and private key into db", async () => {
        await dbWallet.addKey(fundedAddress, fundedPrivateKey);
        await dbWallet.addKey(targetAddress, targetPrivateKey);
        const targetPrivateKeyFromDb = await dbWallet.getKey(targetAddress);
        const fundedPrivateKeyFromDb = await dbWallet.getKey(fundedAddress);
        expect(targetPrivateKeyFromDb).to.equal(targetPrivateKey);
        expect(fundedPrivateKeyFromDb).to.equal(fundedPrivateKey);
    });

    it("Should send funds and retrieve transaction", async () => {
        const balanceBefore = await blockChainHelper.getBalance(targetAddress);
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendDOGE, "TestNote", undefined, true);
        const balanceAfter = await blockChainHelper.getBalance(targetAddress);
        const retrievedTransaction = await blockChainHelper.getTransaction(transaction);
        expect(transaction).to.equal(retrievedTransaction?.hash);
        expect(balanceAfter.toNumber()).to.be.greaterThan(balanceBefore.toNumber());
    });

});
