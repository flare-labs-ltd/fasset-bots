import { expect } from "chai";
import { ORM } from "../../../src/config/orm";
import { DBWalletKeys } from "../../../src/underlying-chain/WalletKeys";
import { createTestOrmOptions } from "../../../test/utils/test-bot-config";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
const chai = require('chai');
chai.use(require('chai-as-promised'));

let orm: ORM;
let dbWallet: DBWalletKeys;

const address1 = "rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8";
const privateKey1 = "0058C2435FB3951ACC29F4D7396632713063F9DB3C49B320167F193CDA0E3A1622";
const address2 = "r4CrUeY9zcd4TpndxU5Qw9pVXfobAXFWqq";
const privateKey2 = "00AF22D6EB35EFFC065BC7DBA21068DB400F1EC127A3F4A3744B676092AAF04187";


describe("Wallet keys tests", async () => {

    before(async () => {
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate', dbName: 'fasset-bots-wallet-keys-test.db' }));
        dbWallet = new DBWalletKeys(orm.em);
    })

    it("Should insert address with private key into db and retrieved it", async () => {
        await dbWallet.addKey(address1, privateKey1);
        await dbWallet.addKey(address2, privateKey2);
        const privateKey1FromDb = await dbWallet.getKey(address1);
        const privateKey2FromDb = await dbWallet.getKey(address2);
        expect(privateKey1FromDb).to.equal(privateKey1);
        expect(privateKey2FromDb).to.equal(privateKey2);
    });

    it("Should not insert address the same address with different private key", async () => {
        await dbWallet.addKey(address1, privateKey2);
        const privateKey1FromDb = await dbWallet.getKey(address1);
        expect(privateKey1FromDb).to.equal(privateKey1);
    });

    it("Should return private key, when class is recreated", async() => {
        dbWallet = new DBWalletKeys(orm.em);
        const privateKey2FromDb = await dbWallet.getKey(address2);
        expect(privateKey2FromDb).to.equal(privateKey2);
    });

});
