import { expect } from "chai";
import { createBlockChainHelper, createBlockChainWalletHelper } from "../../../src/config/BotConfig";
import { ORM } from "../../../src/config/orm";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { BlockChainWalletHelper } from "../../../src/underlying-chain/BlockChainWalletHelper";
import { DBWalletKeys } from "../../../src/underlying-chain/WalletKeys";
import { SourceId } from "../../../src/verification/sources/sources";
import { createTestOrmOptions } from "../../test-utils/test-bot-config";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chai = require('chai');
// eslint-disable-next-line @typescript-eslint/no-var-requires
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
        const account0 = await walletHelper.addExistingAccount(fundedAddress, fundedPrivateKey);
        const privateKey0 = await dbWallet.getKey(account0);
        expect(privateKey0).to.eq(fundedPrivateKey);
        const account1 = await walletHelper.addExistingAccount(targetAddress, targetPrivateKey);
        const privateKey1 = await dbWallet.getKey(account1);
        expect(privateKey1).to.eq(targetPrivateKey);
    });

    it("Should send funds and retrieve transaction", async () => {
        await walletHelper.addExistingAccount(fundedAddress, fundedPrivateKey);
        const balanceBefore = await blockChainHelper.getBalance(targetAddress);
        const options = { maxFee: 12 }; // maxFee in Drops
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendXRP, null, options, true);
        const balanceAfter = await blockChainHelper.getBalance(targetAddress);
        const retrievedTransaction = await blockChainHelper.getTransaction(transaction);
        expect(transaction).to.equal(retrievedTransaction?.hash);
        expect(balanceAfter.gt(balanceBefore)).to.be.true;
    });

    it("Should not send funds: fee > maxFee", async () => {
        await walletHelper.addExistingAccount(fundedAddress, fundedPrivateKey);
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        const maxFee = 8;
        const fee = 10;
        const options = { maxFee: maxFee }; // maxFee in Drops
        await expect(walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendXRP, note, options, true)).to.eventually.be.rejectedWith(`Transaction is not prepared: maxFee ${maxFee} is higher than fee ${fee}`).and.be.an.instanceOf(Error);
    });

    it("Should not add multi transaction - method not implemented", async () => {
        await expect(walletHelper.addMultiTransaction()).to.eventually.be.rejectedWith("Method not implemented.").and.be.an.instanceOf(Error);
    });

    it("Should add transaction - source address not found in db", async () => {
        await expect(walletHelper.addTransaction(targetAddress, fundedAddress, amountToSendXRP, null, undefined, true)).to.eventually.be.rejectedWith(`Cannot find address ${targetAddress}`).and.be.an.instanceOf(Error);
    });

});
