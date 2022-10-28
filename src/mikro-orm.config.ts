import { Options } from "@mikro-orm/core";
import { AbstractSqlDriver } from "@mikro-orm/knex";
import { AgentEntity, Redemption, WalletAddress } from "./actors/entities";

const options: Options<AbstractSqlDriver> = {
    entities: [WalletAddress, AgentEntity, Redemption],
    type: 'sqlite',
    dbName: 'fasset-bots.db',
    debug: false,
}

export default options;
