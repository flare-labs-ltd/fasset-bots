import { expect } from "chai";
import { Challenger } from "../../../src/actors/Challenger";
import { ORM } from "../../../src/config/orm";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { TrackedState } from "../../../src/state/TrackedState";
import { ScopedRunner } from "../../../src/utils/events/ScopedRunner";
import { systemTimestamp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { createTestAssetContext } from "../../test-utils/test-asset-context";


describe("Challenger unit tests", async () => {
    let accounts: string[];
    let context: IAssetBotContext;
    let runner: ScopedRunner;
    let challengerAddress: string;
    let orm: ORM;
    let state: TrackedState;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        const lastBlock = await web3.eth.getBlockNumber();
        state = new TrackedState(context, lastBlock);
        await state.initialize();
        runner = new ScopedRunner();
        challengerAddress = accounts[10];
    });

    it("Should create challenger", async () => {

        const challenger = new Challenger(runner, challengerAddress, state, systemTimestamp());
        expect(challenger.address).to.eq(challengerAddress);
    });

});