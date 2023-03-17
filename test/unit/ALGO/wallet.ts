import { createBlockChainHelper, createBlockChainWalletHelper } from "../../../src/config/BotConfig";
import { ORM } from "../../../src/config/orm";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { BlockChainWalletHelper } from "../../../src/underlying-chain/BlockChainWalletHelper";
import { DBWalletKeys } from "../../../src/underlying-chain/WalletKeys";
import { SourceId } from "../../../src/verification/sources/sources";
import { createTestOrmOptions } from "../../test-utils/test-bot-config";
import { removeWalletAddressFromDB } from "../../test-utils/test-helpers";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);

let orm: ORM;
let dbWallet: DBWalletKeys;
let walletHelper: BlockChainWalletHelper;
let blockChainHelper: BlockChainHelper;
const sourceId: SourceId = SourceId.ALGO;

const fundedAddress = "T6WVPM7WLGP3DIBWNN3LJGCUNMFRR67BVV5KNS3VJ5HSEAQ3QKTGY5ZKWM";
const fundedPrivateKey = "UvwtoiKaq8lbnS7EFJilRLDJrP5CxALEFX33OkPEq3qfrVez9lmfsaA2a3a0mFRrCxj74a16pst1T08iAhuCpg";
const targetAddress = "O2GT7KTTT7ESYYR6CJ23QQHXCVNV5W3MGYOYA2MGBPND5MB2BOPGVKFTLE";
const targetPrivateKey = "9BgYnNJDoyja61qVaEkoiKB41dD6XGCi7cKADtpq/tt2jT+qc5/JLGI+EnW4QPcVW17bbDYdgGmGC9o+sDoLng==";
const amountToSendALGO = 0.05;

describe("ALGO wallet tests", async () => {

    before(async () => {
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
        dbWallet = new DBWalletKeys(orm.em);
        blockChainHelper = createBlockChainHelper(sourceId);
        walletHelper = createBlockChainWalletHelper(sourceId, orm.em);
    });

    it("Should create account", async () => {
        const account = await walletHelper.createAccount();
        const privateKey = await dbWallet.getKey(account);
        expect(privateKey).to.not.be.null;
    });

    it("Should add account", async () => {
        const account1 = await walletHelper.addExistingAccount(fundedAddress, fundedPrivateKey);
        const privateKey1 = await dbWallet.getKey(account1);
        expect(privateKey1).to.eq(fundedPrivateKey);
        const account2 = await walletHelper.addExistingAccount(targetAddress, targetPrivateKey);
        const privateKey2 = await dbWallet.getKey(account2);
        expect(privateKey2).to.eq(targetPrivateKey);
        await removeWalletAddressFromDB(orm, fundedAddress);
        await removeWalletAddressFromDB(orm, targetAddress);
    });

    it("Should send funds and retrieve transaction", async () => {
        await walletHelper.addExistingAccount(fundedAddress, fundedPrivateKey);
        const balanceBefore = await walletHelper.getBalance(targetAddress);
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab"
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendALGO, note, undefined, true);
        const balanceAfter = await walletHelper.getBalance(targetAddress);
        const retrievedTransaction = await blockChainHelper.getTransaction(transaction);
        expect(transaction).to.equal(retrievedTransaction?.hash);
        expect(balanceAfter.gt(balanceBefore)).to.be.true;
        await removeWalletAddressFromDB(orm, fundedAddress);
    });

    it("Should not add multi transaction - method not implemented", async () => {
        await expect(walletHelper.addMultiTransaction()).to.eventually.be.rejectedWith("Method not implemented.").and.be.an.instanceOf(Error);
    });

});
