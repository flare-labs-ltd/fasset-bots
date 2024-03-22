import { createOrm, CreateOrmOptions } from "../../../src/config/orm";
import { existsSync, rm } from "fs";
import { expect } from "chai";
import { WalletAddress } from "../../../src/entities/wallet";
import { BNType } from "../../../src/config/orm-types";
import { toBN } from "../../../src/utils/helpers";
import BN from "bn.js";

const dbNameSqlite: string = "fasset-bots-unit-test-sqlite.db";
const dbNameMySql: string = "fasset-bots-unit-test-mysql";
const dbNamePostgres: string = "fasset-bots-unit-test-postgres";
const dbOptionsSqlite: CreateOrmOptions = { dbName: dbNameSqlite, type: "sqlite", entities: [WalletAddress] };
const dbOptionsMySql: CreateOrmOptions = { dbName: dbNameMySql, type: "mysql", entities: [WalletAddress] };
const dbOptionsPostgres: CreateOrmOptions = { dbName: dbNamePostgres, type: "postgresql", entities: [WalletAddress] };

describe("Orm config tests",  () => {
    it("Should create database", async () => {
        await createOrm(dbOptionsSqlite);
        const exist1 = existsSync(dbNameSqlite);
        expect(exist1).to.be.true;
        // clean up, aka delete new file
        if (exist1) {
            rm(dbNameSqlite, (err) => {
                if (err) {
                    console.error(err);
                    return;
                }
                console.log("File deleted successfully");
            });
        }
    });

    it.skip("Should create database", async () => {
        const ormMySql = await createOrm(dbOptionsMySql);
        expect(ormMySql.em).to.not.be.null;
        const ormPostgres = await createOrm(dbOptionsPostgres);
        expect(ormPostgres.em).to.not.be.null;
    });

    it("Should update database", async () => {
        await createOrm({ ...dbOptionsSqlite, schemaUpdate: "recreate" });
        const exist = existsSync(dbNameSqlite);
        await createOrm({ ...dbOptionsSqlite, schemaUpdate: "safe" });
        const exist2 = existsSync(dbNameSqlite);
        await createOrm({ ...dbOptionsSqlite, schemaUpdate: "full" });
        const exist3 = existsSync(dbNameSqlite);
        expect(exist).to.be.true;
        expect(exist2).to.be.true;
        expect(exist3).to.be.true;
        // clean up, aka delete new file
        if (exist) {
            rm(dbNameSqlite, (err) => {
                if (err) {
                    console.error(err);
                    return;
                }
                console.log("File deleted successfully");
            });
        }
    });

    it("Should convert to JS value", () => {
        const bnType = new BNType();
        const value = "10";
        expect(bnType.convertToJSValue(value).toString()).to.eq(new BN(value, 10).toString());
        expect(bnType.convertToJSValue(toBN(value)).toString()).to.eq(toBN(value).toString());
    });
});
