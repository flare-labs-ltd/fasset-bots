import { expect, spy, use } from "chai";
import spies from "chai-spies";
import { Liquidator } from "../../../src/actors/Liquidator";
import { MockChain } from "../../../src/mock/MockChain";
import { MockTrackedState } from "../../../src/mock/MockTrackedState";
import { TrackedState } from "../../../src/state/TrackedState";
import { ScopedRunner } from "../../../src/utils/events/ScopedRunner";
import { checkedCast } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { testNotifierTransports } from "../../../test/test-utils/testNotifierTransports";
import { TestAssetBotContext, TestAssetTrackedStateContext, createTestAssetContext, getTestAssetTrackedStateContext } from "../../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../../test-utils/hardhat-test-helpers";
use(spies);

describe("Liquidator unit tests", () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let trackedStateContext: TestAssetTrackedStateContext;
    let liquidatorAddress: string;
    let governance: string;
    let ownerAddress: string;
    let runner: ScopedRunner;
    let state: TrackedState;
    let chain: MockChain;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        liquidatorAddress = accounts[10];
        ownerAddress = accounts[12];
        governance = accounts[0];
    });

    async function initialize() {
        context = await createTestAssetContext(governance, testChainInfo.xrp);
        trackedStateContext = getTestAssetTrackedStateContext(context);
        chain = checkedCast(trackedStateContext.blockchainIndexer.chain, MockChain);
        runner = new ScopedRunner();
        state = new TrackedState(trackedStateContext);
        await state.initialize();
        return { context, trackedStateContext, runner, state };
    }

    beforeEach(async () => {
        ({ context, trackedStateContext, runner, state } = await loadFixtureCopyVars(initialize));
    });

    afterEach(function () {
        spy.restore(console);
    });

    it("Should create liquidator", async () => {
        const liquidator = new Liquidator(context, runner, liquidatorAddress, state, testNotifierTransports);
        expect(liquidator.address).to.eq(liquidatorAddress);
    });

    it("Should not run step - error", async () => {
        const spyConsole = spy.on(console, "error");
        const mockState = new MockTrackedState(trackedStateContext, null);
        await mockState.initialize();
        const liquidator = new Liquidator(trackedStateContext, runner, liquidatorAddress, mockState, testNotifierTransports);
        expect(liquidator.address).to.eq(liquidatorAddress);
        await liquidator.runStep();
        expect(spyConsole).to.be.called.once;
    });
});
