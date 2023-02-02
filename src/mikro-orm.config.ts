import { Options } from "@mikro-orm/core";
import { AbstractSqlDriver } from "@mikro-orm/knex";
import { AgentEntity, AgentMinting, AgentRedemption } from "./entities/agent";
import { ActorEntity } from "./entities/actor";
import { WalletAddress } from "./entities/wallet";
import { createOrm, CreateOrmOptions } from "./config/orm";

const options: Options<AbstractSqlDriver> = {
    entities: [WalletAddress, AgentEntity, AgentMinting, AgentRedemption, ActorEntity],
    type: 'sqlite',
    dbName: 'fasset-bots.db',
    debug: false,
}

export async function overrideAndCreateOrm(optionsOverride: CreateOrmOptions = {}) {
    const createOptions: CreateOrmOptions = { ...options, ...optionsOverride };
    return await createOrm(createOptions);
}

export default options;