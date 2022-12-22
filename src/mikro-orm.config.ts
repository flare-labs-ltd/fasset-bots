import { Options } from "@mikro-orm/core";
import { AbstractSqlDriver } from "@mikro-orm/knex";
import { AgentEntity, AgentMinting, AgentRedemption } from "./entities/agent";
import { ActorEntity } from "./entities/actor";
import { WalletAddress } from "./entities/wallet";

const options: Options<AbstractSqlDriver> = {
    entities: [WalletAddress, AgentEntity, AgentMinting, AgentRedemption, ActorEntity],
    type: 'sqlite',
    dbName: 'fasset-bots.db',
    debug: false,
}

export default options;
