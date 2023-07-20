import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { disableMccTraceManager } from "../../test-utils/helpers";
import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/create-test-asset-context";
import spies from "chai-spies";
import { expect, spy, use } from "chai";
import { ActorBase } from "../../../src/fasset-bots/ActorBase";
import { ActorBaseRunner } from "../../../src/actors/ActorBaseRunner";
import { ScopedRunner } from "../../../src/utils/events/ScopedRunner";
import { TrackedState } from "../../../src/state/TrackedState";
use(spies);

const loopDelay: number = 2;
describe("Actor base runner tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let ownerAddress: string;

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
        ownerAddress = accounts[1];
    });

    beforeEach(async () => {
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
    });

    it("Should run actor base runner until its stopped", async () => {
        const actor = new ActorBase(new ScopedRunner(), ownerAddress, new TrackedState(context, await web3.eth.getBlockNumber()));
        const actorBaseRunner = new ActorBaseRunner(loopDelay, actor);
        const spyStep = spy.on(actorBaseRunner, 'runStep');
        actorBaseRunner.requestStop();
        void actorBaseRunner.run();
        actorBaseRunner.requestStop();
        expect(spyStep).to.have.been.called.once;
    });

});