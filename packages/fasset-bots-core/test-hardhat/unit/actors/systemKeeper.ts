import { expect, spy, use } from "chai";
import spies from "chai-spies";
import { SystemKeeper } from "../../../src/actors/SystemKeeper";
import { MockTrackedState } from "../../../src/mock/MockTrackedState";
import { TrackedState } from "../../../src/state/TrackedState";
import { ScopedRunner } from "../../../src/utils/events/ScopedRunner";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { TestAssetTrackedStateContext, createTestAssetContext, getTestAssetTrackedStateContext } from "../../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../../test-utils/hardhat-test-helpers";
use(spies);

describe("System keeper unit tests", () => {
    let accounts: string[];
    let trackedStateContext: TestAssetTrackedStateContext;
    let systemKeeperAddress: string;
    let runner: ScopedRunner;
    let state: TrackedState;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        systemKeeperAddress = accounts[10];
    });

    async function initialize() {
        trackedStateContext = getTestAssetTrackedStateContext(await createTestAssetContext(accounts[0], testChainInfo.xrp));
        runner = new ScopedRunner();
        const lastBlock = await web3.eth.getBlockNumber();
        state = new TrackedState(trackedStateContext, lastBlock);
        await state.initialize();
        return { trackedStateContext, runner, state };
    }

    beforeEach(async () => {
        ({ trackedStateContext, runner, state } = await loadFixtureCopyVars(initialize));
    });

    afterEach(function () {
        spy.restore(console);
    });

    it("Should create system keeper", async () => {
        const systemKeeper = new SystemKeeper(runner, systemKeeperAddress, state);
        expect(systemKeeper.address).to.eq(systemKeeperAddress);
    });

    it("Should not run step - error", async () => {
        const spyConsole = spy.on(console, "error");
        const lastBlock = await web3.eth.getBlockNumber();
        const mockState = new MockTrackedState(trackedStateContext, lastBlock, null);
        await mockState.initialize();
        const systemKeeper = new SystemKeeper(runner, systemKeeperAddress, mockState);
        expect(systemKeeper.address).to.eq(systemKeeperAddress);
        await systemKeeper.runStep();
        expect(spyConsole).to.be.called.once;
    });
});
