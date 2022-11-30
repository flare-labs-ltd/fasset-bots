import { MCC } from "@flarenetwork/mcc";
import { expect } from "chai";
import { WALLET } from "simple-wallet";
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
const sourceId: SourceId = SourceId.BTC;

const fundedAddress = "mzM88w7CdxrFyzE8RKZmDmgYQgT5YPdA6S";
const fundedPrivateKey = "cNcsDiLQrYLi8rBERf9XPEQqVPHA7mUXHKWaTrvJVCTaNa68ZDqF";
const targetAddress = "mwLGdsLWvvGFapcFsx8mwxBUHfsmTecXe2";
const targetPrivateKey = "cTceSr6rvmAoQAXq617sk4smnzNUvAqkZdnfatfsjbSixBcJqDcY";

const amountToSendBTC = 0.00001;

describe("BTC wallet tests", async () => {

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

    it.skip("Should send funds and retrieve transaction", async () => {
        const balanceBefore = await blockChainHelper.getBalance(targetAddress);
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendBTC, "TestNote", undefined, true);
        const balanceAfter = await blockChainHelper.getBalance(targetAddress);
        const retrievedTransaction = await blockChainHelper.getTransaction(transaction);
        expect(transaction).to.equal(retrievedTransaction?.hash);
        expect(balanceAfter.toNumber()).to.be.greaterThan(balanceBefore.toNumber());
    });

});
