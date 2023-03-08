import { expect } from "chai";
import { createBlockChainWalletHelper } from "../../../src/config/BotConfig";
import { ORM } from "../../../src/config/orm";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { BlockChainWalletHelper } from "../../../src/underlying-chain/BlockChainWalletHelper";
import { DBWalletKeys } from "../../../src/underlying-chain/WalletKeys";
import { SourceId } from "../../../src/verification/sources/sources";
import { createTestOrmOptions } from "../../test-utils/test-bot-config";

let orm: ORM;
let dbWallet: DBWalletKeys;
let walletHelper: BlockChainWalletHelper;
const sourceId: SourceId = SourceId.BTC;

const fundedAddress = "mzM88w7CdxrFyzE8RKZmDmgYQgT5YPdA6S";
const fundedPrivateKey = "cNcsDiLQrYLi8rBERf9XPEQqVPHA7mUXHKWaTrvJVCTaNa68ZDqF";
const targetAddress = "mwLGdsLWvvGFapcFsx8mwxBUHfsmTecXe2";
const targetPrivateKey = "cTceSr6rvmAoQAXq617sk4smnzNUvAqkZdnfatfsjbSixBcJqDcY";

const amountToSendBTC = 0.00001;

describe("BTC wallet tests", async () => {

    before(async () => {
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
        dbWallet = new DBWalletKeys(orm.em);
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
    });

    it("Should send funds", async () => {
        await walletHelper.addExistingAccount(fundedAddress, fundedPrivateKey);
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendBTC, "TestNote", undefined, false);
        expect(transaction).to.not.be.null;
    });

});
