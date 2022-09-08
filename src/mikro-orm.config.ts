import { Options } from "@mikro-orm/core";
import { Redemption } from "./actors/entities";

const options: Options = {
    entities: [Redemption],
    type: 'sqlite',
    dbName: 'fasset-bots.db',
    debug: true,
}

export default options;
