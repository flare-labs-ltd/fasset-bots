import { Options } from "@mikro-orm/core";
import { AbstractSqlDriver } from "@mikro-orm/knex";
import { DatabaseAccount } from "./config/config-files/SecretsFile";
import { CreateOrmOptions, ORM, createOrm } from "./config/orm";
import { simpleWalletEntities } from "@flarelabs/simple-wallet";
import { agentBotEntities, otherBotEntitites } from "./entities";

/* istanbul ignore next */
const options: Options<AbstractSqlDriver> = {
    entities: [...simpleWalletEntities, ...agentBotEntities, ...otherBotEntitites],
    dbName: "fasset-bots.db",
    debug: false,
};

export async function overrideAndCreateOrm(optionsOverride: CreateOrmOptions, databaseAccount: DatabaseAccount | undefined, defaultOptions: Options<AbstractSqlDriver> = options): Promise<ORM> {
    const createOptions: CreateOrmOptions = { ...defaultOptions, ...databaseAccount, ...optionsOverride };
    return createOrm(createOptions);
}

export default options;
