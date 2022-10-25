import { PersistentAgent } from "../../../src/actors/PersistentAgent";
import { BotConfig } from "../../../src/config/BotConfig";
import { createAssetContext } from "../../../src/config/create-asset-context";
import { PersistenceContext } from "../../../src/config/PersistenceContext";
import { IAssetContext } from "../../../src/fasset/IAssetContext";
import { initTestWeb3 } from "../../../src/utils/web3";
import { createTestConfig } from "./test-config";

describe("Persistent agent tests", async () => {
    let accounts: string[];
    let config: BotConfig;
    let context: IAssetContext;
    let pc: PersistenceContext;
    let ownerAddress: string;

    before(async () => {
        accounts = await initTestWeb3('local');
        ownerAddress = accounts[5];
        config = await createTestConfig();
        context = await createAssetContext(config, config.chains[0]);
        pc = await PersistenceContext.create();
    });
    
    it("create agent", async () => {
        await PersistentAgent.create(pc, context, ownerAddress);
    });
});
