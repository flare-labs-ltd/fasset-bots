import { Options } from "@mikro-orm/core";
import { AbstractSqlDriver } from "@mikro-orm/knex";
import { AgentEntity, AgentMinting, AgentRedemption } from "./entities/agent";
import { WalletAddress } from "./entities/wallet";
import { createOrm, CreateOrmOptions, ORM } from "./config/orm";

const options: Options<AbstractSqlDriver> = {
    entities: [WalletAddress, AgentEntity, AgentMinting, AgentRedemption],
    type: 'sqlite',
    dbName: 'fasset-bots.db',
    debug: false,
}

export async function overrideAndCreateOrm(optionsOverride: CreateOrmOptions = {}): Promise<ORM> {
    const createOptions: CreateOrmOptions = { ...options, ...optionsOverride };
    return await createOrm(createOptions);
}

export default options;