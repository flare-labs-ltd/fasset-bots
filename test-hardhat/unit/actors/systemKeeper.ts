import { expect } from "chai";
import { SystemKeeper } from "../../../src/actors/SystemKeeper";
import { ORM } from "../../../src/config/orm";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { TrackedState } from "../../../src/state/TrackedState";
import { ScopedRunner } from "../../../src/utils/events/ScopedRunner";
import { web3 } from "../../../src/utils/web3";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { createTestAssetContext } from "../../test-utils/create-test-asset-context";


describe("System keeper unit tests", async () => {
    let accounts: string[];
    let context: IAssetBotContext;
    let systemKeeperAddress: string;
    let orm: ORM;
    let runner: ScopedRunner;
    let state: TrackedState;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        systemKeeperAddress = accounts[10];
        runner = new ScopedRunner();
        const lastBlock = await web3.eth.getBlockNumber();
        state = new TrackedState(context, lastBlock);
        await state.initialize();
    });

    it("Should create system keeper", async () => {
        const systemKeeper = new SystemKeeper(runner, systemKeeperAddress, state);
        expect(systemKeeper.address).to.eq(systemKeeperAddress);
    });

});