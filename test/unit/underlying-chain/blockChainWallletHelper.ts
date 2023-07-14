import { createBlockchainIndexerHelper, createBlockchainWalletHelper } from "../../../src/config/BotConfig";
import { ORM } from "../../../src/config/orm";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { DBWalletKeys } from "../../../src/underlying-chain/WalletKeys";
import { SourceId } from "../../../src/verification/sources/sources";
import { createTestOrmOptions } from "../../test-utils/test-bot-config";
import { removeWalletAddressFromDB } from "../../test-utils/test-helpers";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
import { BlockchainIndexerHelper } from "../../../src/underlying-chain/BlockchainIndexerHelper";
import { BlockchainWalletHelper } from "../../../src/underlying-chain/BlockchainWalletHelper";
use(chaiAsPromised);

let orm: ORM;
let dbWallet: DBWalletKeys;
let walletHelper: BlockchainWalletHelper;
let blockChainIndexerHelper: BlockchainIndexerHelper;

describe("XRP wallet tests", async () => {

    const sourceId: SourceId = SourceId.XRP;
    const indexerUrl: string = "https://attestation-coston2.aflabs.net/verifier/xrp/";
    const walletUrl: string = "https://s.altnet.rippletest.net:51234";
    const fundedAddress = "rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8";
    const fundedPrivateKey = "0058C2435FB3951ACC29F4D7396632713063F9DB3C49B320167F193CDA0E3A1622";
    const targetAddress = "r4CrUeY9zcd4TpndxU5Qw9pVXfobAXFWqq";
    const targetPrivateKey = "00AF22D6EB35EFFC065BC7DBA21068DB400F1EC127A3F4A3744B676092AAF04187";
    const amountToSendDrops = 1000000;

    before(async () => {
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
        dbWallet = new DBWalletKeys(orm.em);
        blockChainIndexerHelper = createBlockchainIndexerHelper(sourceId, indexerUrl);
        walletHelper = createBlockchainWalletHelper(sourceId, orm.em, walletUrl);
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

    it("Should send funds and retrieve transaction", async () => {
        await walletHelper.addExistingAccount(fundedAddress, fundedPrivateKey);
        const balanceBefore = await walletHelper.getBalance(targetAddress);
        const options = { maxFee: 12 }; // maxFee in Drops
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendDrops, null, options, true);
        const balanceAfter = await walletHelper.getBalance(targetAddress);
        const retrievedTransaction = await blockChainIndexerHelper.getTransaction(transaction);
        expect(transaction).to.equal(retrievedTransaction?.hash);
        expect(balanceAfter.gt(balanceBefore)).to.be.true;
        await removeWalletAddressFromDB(orm, fundedAddress);
    });

    it("Should not send funds: fee > maxFee", async () => {
        await walletHelper.addExistingAccount(fundedAddress, fundedPrivateKey);
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        const maxFee = 8;
        const fee = 10;
        const options = { maxFee: maxFee }; // maxFee in Drops
        await expect(walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendDrops, note, options, false)).to.eventually.be.rejectedWith(`Transaction is not prepared: maxFee ${maxFee} is higher than fee ${fee}`).and.be.an.instanceOf(Error);
        await removeWalletAddressFromDB(orm, fundedAddress);
    });

    it("Should not add multi transaction - method not implemented", async () => {
        await expect(walletHelper.addMultiTransaction()).to.eventually.be.rejectedWith("Method not implemented.").and.be.an.instanceOf(Error);
    });

    it("Should add transaction - source address not found in db", async () => {
        await expect(walletHelper.addTransaction(targetAddress, fundedAddress, amountToSendDrops, null, undefined, false)).to.eventually.be.rejectedWith(`Cannot find address ${targetAddress}`).and.be.an.instanceOf(Error);
    });

    it("Should get transaction fee", async () => {
        const fee = await walletHelper.getTransactionFee();
        expect(fee.gtn(0));
    });

});

describe("BTC wallet tests", async () => {

    const sourceId: SourceId = SourceId.BTC;
    const walletUrl: string = "https://api.bitcore.io/api/BTC/testnet/";
    const fundedAddress = "mzM88w7CdxrFyzE8RKZmDmgYQgT5YPdA6S";
    const fundedPrivateKey = "cNcsDiLQrYLi8rBERf9XPEQqVPHA7mUXHKWaTrvJVCTaNa68ZDqF";
    const targetAddress = "mwLGdsLWvvGFapcFsx8mwxBUHfsmTecXe2";
    const targetPrivateKey = "cTceSr6rvmAoQAXq617sk4smnzNUvAqkZdnfatfsjbSixBcJqDcY";

    before(async () => {
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
        dbWallet = new DBWalletKeys(orm.em);
        walletHelper = createBlockchainWalletHelper(sourceId, orm.em, walletUrl, true);
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

});

describe("DOGE wallet tests", async () => {

    const sourceId: SourceId = SourceId.DOGE;
    const indexerUrl: string = "https://attestation-coston2.aflabs.net/verifier/doge/";
    const walletUrl: string = "https://api.bitcore.io/api/DOGE/testnet/";
    const fundedAddress = "nou7f8j829FAEb4SzLz3F1N1CrMAy58ohw";
    const fundedPrivateKey = "cfHf9MCiZbPidE1XXxCCBnzwJSKRtvpfoZrY6wFvy17HmKbBqt1j";
    const targetAddress = "nk1Uc5w6MHC1DgtRvnoQvCj3YgPemzha7D";
    const targetPrivateKey = "ckmubApfH515MCZNC9ufLR4kHrmnb1PCtX2vhoN4iYx9Wqzh2AQ9";
    const amountToSendSatoshies = 100000000;

    before(async () => {
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
        dbWallet = new DBWalletKeys(orm.em);
        blockChainIndexerHelper = createBlockchainIndexerHelper(sourceId, indexerUrl);
        walletHelper = createBlockchainWalletHelper(sourceId, orm.em, walletUrl, true);
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

    it("Should send funds", async () => {
        await walletHelper.addExistingAccount(fundedAddress, fundedPrivateKey);
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendSatoshies, "TestNote", undefined, false);
        expect(transaction).to.not.be.null;
        await removeWalletAddressFromDB(orm, fundedAddress);
    });

});
