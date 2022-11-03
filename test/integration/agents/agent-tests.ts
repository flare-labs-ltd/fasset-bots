import { AgentBot } from "../../../src/actors/AgentBot";
import { BotConfig } from "../../../src/config/BotConfig";
import { createAssetContext } from "../../../src/config/create-asset-context";
import { ORM } from "../../../src/config/orm";
import { IAssetContext } from "../../../src/fasset/IAssetContext";
import { initTestWeb3 } from "../../../src/utils/web3";
import { createTestOrm } from "../../test.mikro-orm.config";
import { createTestConfig } from "./test-config";

describe("Agent bot tests", async () => {
    let accounts: string[];
    let config: BotConfig;
    let context: IAssetContext;
    let orm: ORM;
    let ownerAddress: string;

    before(async () => {
        accounts = await initTestWeb3('local');
        ownerAddress = accounts[5];
        config = await createTestConfig();
        context = await createAssetContext(config, config.chains[0]);
        orm = await createTestOrm({ schemaUpdate: 'recreate' });
    });
    
    beforeEach(async () => {
        orm.em.clear();
    });

    it("create agent", async () => {
        await AgentBot.create(orm.em, context, ownerAddress);
    });
    
    it("", async () => {
        
    });
});
