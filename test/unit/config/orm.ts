import { createOrm, CreateOrmOptions, ORM } from "../../../src/config/orm";
import { existsSync, rm } from "fs";
import { expect } from "chai";
import { WalletAddress } from "../../../src/entities/wallet";

const dbName: string = 'fasset-bots-unit-test.db';
const dbOptions: CreateOrmOptions = { dbName: dbName, type: 'sqlite', entities: [WalletAddress] };
describe("Orm config tests", async () => {

    it("Should create database", async() => {
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
        const exist = existsSync(dbName);
        const exist2 = existsSync(dbName);
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