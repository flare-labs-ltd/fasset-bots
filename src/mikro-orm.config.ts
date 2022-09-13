import { Options } from "@mikro-orm/core";
import { AgentEntity, Redemption, WalletAddress } from "./actors/entities";

const options: Options = {
    entities: [WalletAddress, AgentEntity, Redemption],
    type: 'sqlite',
    dbName: 'fasset-bots.db',
    debug: true,
}

export default options;
