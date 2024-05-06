import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { Secrets } from "../../../src/config";
import { createBlockchainWalletHelper } from "../../../src/config/BotConfig";
import { ORM } from "../../../src/config/orm";
import { BlockchainWalletHelper } from "../../../src/underlying-chain/BlockchainWalletHelper";
import { ChainId } from "../../../src/underlying-chain/SourceId";
import { DBWalletKeys } from "../../../src/underlying-chain/WalletKeys";
import { createTestOrm } from "../../test-utils/create-test-orm";
import { TEST_SECRETS } from "../../test-utils/test-bot-config";
import { removeWalletAddressFromDB } from "../../test-utils/test-helpers";
use(chaiAsPromised);

let orm: ORM;
let dbWallet: DBWalletKeys;
let walletHelper: BlockchainWalletHelper;

export const fundedAddressXRP = "rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8";
export const fundedPrivateKeyXRP = "0058C2435FB3951ACC29F4D7396632713063F9DB3C49B320167F193CDA0E3A1622";
export const targetAddressXRP = "r4CrUeY9zcd4TpndxU5Qw9pVXfobAXFWqq";
export const targetPrivateKeyXRP = "00AF22D6EB35EFFC065BC7DBA21068DB400F1EC127A3F4A3744B676092AAF04187";

describe("testXRP wallet tests", () => {
    let secrets: Secrets;
    const chainId: ChainId = ChainId.testXRP;
    const walletUrl: string = "https://s.altnet.rippletest.net:51234";
    const amountToSendDrops = 1000000;

    before(async () => {
        secrets = Secrets.load(TEST_SECRETS);
        orm = await createTestOrm();
        dbWallet = DBWalletKeys.from(orm.em, secrets);
        walletHelper = createBlockchainWalletHelper("agent", secrets, chainId, orm.em, walletUrl, { retries: 2 });
    });

    it("Should create account", async () => {
        const account = await walletHelper.createAccount();
        const privateKey = await dbWallet.getKey(account);
        expect(privateKey).to.not.be.null;
    });

    it("Should add account", async () => {
        const account0 = await walletHelper.addExistingAccount(fundedAddressXRP, fundedPrivateKeyXRP);
        const privateKey0 = await dbWallet.getKey(account0);
        expect(privateKey0).to.eq(fundedPrivateKeyXRP);
        const account1 = await walletHelper.addExistingAccount(targetAddressXRP, targetPrivateKeyXRP);
        const privateKey1 = await dbWallet.getKey(account1);
        expect(privateKey1).to.eq(targetPrivateKeyXRP);
        await removeWalletAddressFromDB(walletHelper, fundedAddressXRP);
        await removeWalletAddressFromDB(walletHelper, targetAddressXRP);
    });

    it("Should not send funds: fee > maxFee", async () => {
        await walletHelper.addExistingAccount(fundedAddressXRP, fundedPrivateKeyXRP);
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        const maxFee = 8;
        const fee = 10;
        const options = { maxFee: maxFee }; // maxFee in Drops
        await expect(walletHelper.addTransaction(fundedAddressXRP, targetAddressXRP, amountToSendDrops, note, options))
            .to.eventually.be.rejectedWith(`Transaction is not prepared: fee ${fee} is higher than maxFee ${maxFee}`)
            .and.be.an.instanceOf(Error);
        await removeWalletAddressFromDB(walletHelper, fundedAddressXRP);
    });

    it("Should not add multi transaction - method not implemented", async () => {
        await expect(walletHelper.addMultiTransaction()).to.eventually.be.rejectedWith("Method not implemented.").and.be.an.instanceOf(Error);
    });

    it("Should add transaction - source address not found in db", async () => {
        await expect(walletHelper.addTransaction(targetAddressXRP, fundedAddressXRP, amountToSendDrops, null, undefined))
            .to.eventually.be.rejectedWith(`Cannot find address ${targetAddressXRP}`)
            .and.be.an.instanceOf(Error);
    });

    it("Should get transaction fee", async () => {
        const fee = await walletHelper.getTransactionFee();
        expect(fee.gtn(0));
    });
});

describe("testBTC wallet tests", () => {
    let secrets: Secrets;
    const chainId: ChainId = ChainId.testBTC;
    const walletUrl: string = "https://api.bitcore.io/api/BTC/testnet/";
    const fundedAddress = "mzM88w7CdxrFyzE8RKZmDmgYQgT5YPdA6S";
    const fundedPrivateKey = "cNcsDiLQrYLi8rBERf9XPEQqVPHA7mUXHKWaTrvJVCTaNa68ZDqF";
    const targetAddress = "mwLGdsLWvvGFapcFsx8mwxBUHfsmTecXe2";
    const targetPrivateKey = "cTceSr6rvmAoQAXq617sk4smnzNUvAqkZdnfatfsjbSixBcJqDcY";

    before(async () => {
        secrets = Secrets.load(TEST_SECRETS);
        orm = await createTestOrm();
        dbWallet = DBWalletKeys.from(orm.em, secrets);
        walletHelper = createBlockchainWalletHelper("agent", secrets, chainId, orm.em, walletUrl);
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
        await removeWalletAddressFromDB(walletHelper, fundedAddress);
        await removeWalletAddressFromDB(walletHelper, targetAddress);
    });
});

describe("testDOGE wallet tests", () => {
    let secrets: Secrets;
    const chainId: ChainId = ChainId.testDOGE;
    const walletUrl: string = "https://api.bitcore.io/api/DOGE/testnet/";
    const fundedAddress = "nou7f8j829FAEb4SzLz3F1N1CrMAy58ohw";
    const fundedPrivateKey = "cfHf9MCiZbPidE1XXxCCBnzwJSKRtvpfoZrY6wFvy17HmKbBqt1j";
    const targetAddress = "nk1Uc5w6MHC1DgtRvnoQvCj3YgPemzha7D";
    const targetPrivateKey = "ckmubApfH515MCZNC9ufLR4kHrmnb1PCtX2vhoN4iYx9Wqzh2AQ9";
    const amountToSendSatoshies = 100000000;

    before(async () => {
        secrets = Secrets.load(TEST_SECRETS);
        orm = await createTestOrm();
        dbWallet = DBWalletKeys.from(orm.em, secrets);
        walletHelper = createBlockchainWalletHelper("agent", secrets, chainId, orm.em, walletUrl);
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
        await removeWalletAddressFromDB(walletHelper, fundedAddress);
        await removeWalletAddressFromDB(walletHelper, targetAddress);
    });

    it.skip("Should send funds", async () => {
        await walletHelper.addExistingAccount(fundedAddress, fundedPrivateKey);
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendSatoshies, "TestNote", undefined);
        expect(transaction).to.not.be.null;
        await removeWalletAddressFromDB(walletHelper, fundedAddress);
    });
});
