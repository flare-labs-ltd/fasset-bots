import { MCC } from "@flarenetwork/mcc";
import { expect } from "chai";
import { WALLET } from "simple-wallet";
import { ORM } from "../../../src/config/orm";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { BlockChainWalletHelper } from "../../../src/underlying-chain/BlockChainWalletHelper";
import { DBWalletKeys } from "../../../src/underlying-chain/WalletKeys";
import { createTestOrm } from "../../test.mikro-orm.config";

let orm: ORM;
let dbWallet: DBWalletKeys;
let walletHelper: BlockChainWalletHelper;
let blockChainHelper: BlockChainHelper;

let walletClient: WALLET.LTC;
let mccClient: MCC.LTC;

const fundedAddress = "mzM88w7CdxrFyzE8RKZmDmgYQgT5YPdA6S";
const fundedPrivateKey = "cNcsDiLQrYLi8rBERf9XPEQqVPHA7mUXHKWaTrvJVCTaNa68ZDqF";
const targetAddress = "mwLGdsLWvvGFapcFsx8mwxBUHfsmTecXe2";
const targetPrivateKey = "cTceSr6rvmAoQAXq617sk4smnzNUvAqkZdnfatfsjbSixBcJqDcY";

const LTCWalletConnectionTest = {
    url: process.env.BTC_LTC_DOGE_URL_WALLET || "",
    username: "",
    password: "",
    inTestnet: true
};

const LTCMCCConnectionTest = {
    url: process.env.LTC_URL_TESTNET_MCC || "",
    username: process.env.LTC_URL_USER_NAME_TESTNET_MCC || "",
    password: process.env.LTC_URL_PASSWORD_TESTNET_MCC || "",
    inTestnet: true
};

const amountToSendLTC = 0.00001;

describe("LTC wallet tests", async () => {

    before(async () => {
        orm = await createTestOrm();
        dbWallet = new DBWalletKeys(orm.em);
        walletClient = new WALLET.LTC(LTCWalletConnectionTest);
        mccClient = new MCC.LTC(LTCMCCConnectionTest);
        blockChainHelper = new BlockChainHelper(walletClient, mccClient);
        walletHelper = new BlockChainWalletHelper(walletClient, orm.em, blockChainHelper);
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
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendLTC, "TestNote", undefined, true);
        const balanceAfter = await blockChainHelper.getBalance(targetAddress);
        const retrievedTransaction = await blockChainHelper.getTransaction(transaction);
        expect(transaction).to.equal(retrievedTransaction?.hash);
        expect(balanceAfter.toNumber()).to.be.greaterThan(balanceBefore.toNumber());
    });

});
