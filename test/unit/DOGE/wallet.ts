import { expect } from "chai";
import { createBlockChainHelper, createBlockChainWalletHelper } from "../../../src/config/BotConfig";
import { ORM } from "../../../src/config/orm";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { BlockChainWalletHelper } from "../../../src/underlying-chain/BlockChainWalletHelper";
import { DBWalletKeys } from "../../../src/underlying-chain/WalletKeys";
import { SourceId } from "../../../src/verification/sources/sources";
import { createTestOrmOptions } from "../../test-utils/test-bot-config";
import { removeWalletAddressFromDB } from "../../test-utils/test-helpers";

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
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
        dbWallet = new DBWalletKeys(orm.em);
        blockChainHelper = createBlockChainHelper(sourceId, true);
        walletHelper = createBlockChainWalletHelper(sourceId, orm.em, true);
    });

    it("Should create account", async () => {
        const account = await walletHelper.createAccount();
        const privateKey = await dbWallet.getKey(account);
        expect(privateKey).to.not.be.null;
    });

    it("Should add account", async () => {
        const account0 = await walletHelper.addExistingAccount(fundedAddress, fundedPrivateKey);
        const privateKey0 = await dbWallet.getKey(account0);
        expect(privateKey0).to.eq(fundedPrivateKey);
        const account1 = await walletHelper.addExistingAccount(targetAddress, targetPrivateKey);
        const privateKey1 = await dbWallet.getKey(account1);
        expect(privateKey1).to.eq(targetPrivateKey);
        await removeWalletAddressFromDB(orm, fundedAddress);
        await removeWalletAddressFromDB(orm, targetAddress);
    });

    it.skip("Should send funds and retrieve transaction", async () => {
        await walletHelper.addExistingAccount(fundedAddress, fundedPrivateKey);
        const balanceBefore = await blockChainHelper.getBalance(targetAddress);
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendDOGE, "TestNote", undefined, true);
        const balanceAfter = await blockChainHelper.getBalance(targetAddress);
        const retrievedTransaction = await blockChainHelper.getTransaction(transaction);
        expect(transaction).to.equal(retrievedTransaction?.hash);
        expect(balanceAfter.gt(balanceBefore)).to.be.true;
        await removeWalletAddressFromDB(orm, fundedAddress);
    });

});
