import { expect } from "chai";
import { createBlockChainHelper, createBlockChainWalletHelper } from "../../../src/config/BotConfig";
import { ORM } from "../../../src/config/orm";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { BlockChainWalletHelper } from "../../../src/underlying-chain/BlockChainWalletHelper";
import { DBWalletKeys } from "../../../src/underlying-chain/WalletKeys";
import { SourceId } from "../../../src/verification/sources/sources";
import { createTestOrm } from "../../test.mikro-orm.config";
const chai = require('chai');
chai.use(require('chai-as-promised'));

let orm: ORM;
let dbWallet: DBWalletKeys;
let walletHelper: BlockChainWalletHelper;
let blockChainHelper: BlockChainHelper;
const sourceId: SourceId = SourceId.XRP;

const fundedAddress = "rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8";
const fundedPrivateKey = "0058C2435FB3951ACC29F4D7396632713063F9DB3C49B320167F193CDA0E3A1622";
const targetAddress = "r4CrUeY9zcd4TpndxU5Qw9pVXfobAXFWqq";
const targetPrivateKey = "00AF22D6EB35EFFC065BC7DBA21068DB400F1EC127A3F4A3744B676092AAF04187";

const amountToSendXRP = 1;

describe("XRP wallet tests", async () => {

    before(async () => {
        orm = await createTestOrm({ schemaUpdate: 'recreate' });
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
        const account = await walletHelper.addExistingAccount(fundedAddress, fundedPrivateKey);
        const privateKey = await dbWallet.getKey(account);
        expect(privateKey).to.eq(fundedPrivateKey);
    });

    it("Should send funds and retrieve transaction", async () => {
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        const balanceBefore = await blockChainHelper.getBalance(targetAddress);
        const options = { maxFee: 12 }; // maxFee in Drops
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendXRP, note, options, true);
        const balanceAfter = await blockChainHelper.getBalance(targetAddress);
        const retrievedTransaction = await blockChainHelper.getTransaction(transaction);
        expect(transaction).to.equal(retrievedTransaction?.hash);
        expect(balanceAfter.toNumber()).to.be.greaterThan(balanceBefore.toNumber());
    });

    it("Should not send funds: fee > maxFee", async () => {
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        const options = { maxFee: 8 }; // maxFee in Drops
        await expect(walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendXRP, note, options, true)).to.eventually.be.rejected; 
    });

});
