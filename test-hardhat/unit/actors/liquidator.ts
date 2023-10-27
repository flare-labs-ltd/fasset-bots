import { expect, spy, use } from "chai";
import { Liquidator } from "../../../src/actors/Liquidator";
import { TrackedState } from "../../../src/state/TrackedState";
import { ScopedRunner } from "../../../src/utils/events/ScopedRunner";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import {
    TestAssetBotContext,
    TestAssetTrackedStateContext,
    createTestAssetContext,
    getTestAssetTrackedStateContext,
} from "../../test-utils/create-test-asset-context";
import { MockTrackedState } from "../../../src/mock/MockTrackedState";
import spies from "chai-spies";
import { createTestAgent } from "../../test-utils/helpers";
import { sleep } from "../../../src/utils/helpers";
use(spies);

describe("Liquidator unit tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let trackedStateContext: TestAssetTrackedStateContext;
    let liquidatorAddress: string;
    let governance: string;
    let ownerAddress: string;
    let runner: ScopedRunner;
    let state: TrackedState;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        liquidatorAddress = accounts[10];
        ownerAddress = accounts[12];
        governance = accounts[0];
        context = await createTestAssetContext(governance, testChainInfo.xrp);
        trackedStateContext = getTestAssetTrackedStateContext(context);
        runner = new ScopedRunner();
        const lastBlock = await web3.eth.getBlockNumber();
        state = new TrackedState(trackedStateContext, lastBlock);
        await state.initialize();
    });

    afterEach(function () {
        spy.restore(console);
    });

    it("Should create liquidator", async () => {
        const liquidator = new Liquidator(runner, liquidatorAddress, state);
        expect(liquidator.address).to.eq(liquidatorAddress);
    });

    it("Should not run step - error", async () => {
        const spyConsole = spy.on(console, "error");
        const lastBlock = await web3.eth.getBlockNumber();
        const mockState = new MockTrackedState(trackedStateContext, lastBlock, null);
        await mockState.initialize();
        const liquidator = new Liquidator(runner, liquidatorAddress, mockState);
        expect(liquidator.address).to.eq(liquidatorAddress);
        await liquidator.runStep();
        expect(spyConsole).to.be.called.once;
    });

    it("Should not handle full liquidation - error", async () => {
        const spyConsole = spy.on(console, "error");
        const agent = await createTestAgent(context, ownerAddress);
        const liquidator = new Liquidator(runner, liquidatorAddress, state);
        // change address to invoke error later
        expect(liquidator.address).to.eq(liquidatorAddress);
        await liquidator.handleFullLiquidationStarted(agent.vaultAddress);
        while (liquidator.runner.runningThreads > 0) {
            await sleep(2000);
        }
        expect(spyConsole).to.be.called.once;
    });
});
