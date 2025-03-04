import { expect, spy, use } from "chai";
import spies from "chai-spies";
import { ActorBaseRunner } from "../../../src/actors/ActorBaseRunner";
import { SystemKeeper } from "../../../src/actors/SystemKeeper";
import { ActorBase, ActorBaseKind } from "../../../src/fasset-bots/ActorBase";
import { TrackedState } from "../../../src/state/TrackedState";
import { ScopedRunner } from "../../../src/utils/events/ScopedRunner";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { TestAssetBotContext, createTestAssetContext } from "../../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../../test-utils/hardhat-test-helpers";
use(spies);

const loopDelay: number = 2;
describe("Actor base runner tests", () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let ownerAddress: string;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        ownerAddress = accounts[1];
    });

    async function initialize() {
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        return { context };
    }

    beforeEach(async () => {
        ({ context } = await loadFixtureCopyVars(initialize));
    });

    it("Should run actor base runner until its stopped", async () => {
        const actor = new ActorBase(new ScopedRunner(), ownerAddress, new TrackedState(context));
        const actorBaseRunner = new ActorBaseRunner(loopDelay, actor);
        const spyStep = spy.on(actorBaseRunner, "runStep");
        actorBaseRunner.requestStop();
        void actorBaseRunner.run(ActorBaseKind.SYSTEM_KEEPER);
        actorBaseRunner.requestStop();
        expect(spyStep).to.have.been.called.once;
    });

    it("Should run actor base runner step", async () => {
        const systemKeeperAddress = accounts[20];
        const state = new TrackedState(context);
        await state.initialize();
        const systemKeeper = new SystemKeeper(new ScopedRunner(), systemKeeperAddress, state);
        const systemKeeperRunner = new ActorBaseRunner(loopDelay, systemKeeper);
        const spyStep = spy.on(systemKeeper, "runStep");
        await systemKeeperRunner.runStep(ActorBaseKind.SYSTEM_KEEPER);
        expect(spyStep).to.have.been.called.once;
    });
});
