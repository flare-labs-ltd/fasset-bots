import { createOrm, CreateOrmOptions, ORM } from "../../../src/config/orm";
import { existsSync, rm } from "fs";
import { expect } from "chai";
import { WalletAddress } from "../../../src/entities/wallet";

const dbName: string = 'fasset-bots-unit-test.db';
const dbOptions: CreateOrmOptions = { dbName: dbName, type: 'sqlite', entities: [WalletAddress] };
describe("Orm config tests", async () => {
    let orm: ORM;

    it("Should create database", async() => {
        orm = await createOrm(dbOptions);
        const exist = existsSync(dbName);
        expect(exist).to.be.true;
        // clean up, aka delete new file
        if (exist) {
            rm(dbName, (err) => {
                if (err) {
                    console.error(err);
                    return;
                }
                console.log("File deleted successfully");
            });
        }
    });

    it("Should update database", async() => {
        orm = await createOrm({ ...dbOptions, schemaUpdate: 'recreate'});
        const exist = existsSync(dbName);
        orm = await createOrm({ ...dbOptions, schemaUpdate: 'safe'});
        const exist2 = existsSync(dbName);
        orm = await createOrm({ ...dbOptions, schemaUpdate: 'full'});
        const exist3 = existsSync(dbName);
        expect(exist).to.be.true;
        expect(exist2).to.be.true;
        expect(exist3).to.be.true;
        // clean up, aka delete new file
        if (exist) {
            rm(dbName, (err) => {
                if (err) {
                    console.error(err);
                    return;
                }
                console.log("File deleted successfully");
            });
        }
    });

});