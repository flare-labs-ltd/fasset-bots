import { Options } from "@mikro-orm/core";
import { AbstractSqlDriver } from "@mikro-orm/knex";
import { AgentEntity, AgentMinting, AgentRedemption } from "./entities/agent";
import { ChallengerEntity } from "./entities/challenger";
import { WalletAddress } from "./entities/wallet";

const options: Options<AbstractSqlDriver> = {
    entities: [WalletAddress, AgentEntity, AgentMinting, AgentRedemption, ChallengerEntity],
    type: 'sqlite',
    dbName: 'fasset-bots.db',
    debug: false,
}

export default options;
