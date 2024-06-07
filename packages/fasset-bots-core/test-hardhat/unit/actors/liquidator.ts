import { expect, spy, use } from "chai";
import spies from "chai-spies";
import { Liquidator } from "../../../src/actors/Liquidator";
import { MockTrackedState } from "../../../src/mock/MockTrackedState";
import { TrackedState } from "../../../src/state/TrackedState";
import { ScopedRunner } from "../../../src/utils/events/ScopedRunner";
import { checkedCast, sleep } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { testNotifierTransports } from "../../../test/test-utils/testNotifierTransports";
import { TestAssetBotContext, TestAssetTrackedStateContext, createTestAssetContext, getTestAssetTrackedStateContext } from "../../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../../test-utils/hardhat-test-helpers";
import { createTestAgent, createTestAgentAndMakeAvailable, createTestMinter } from "../../test-utils/helpers";
import { MockChain } from "../../../src/mock/MockChain";
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
        const lastBlock = await web3.eth.getBlockNumber();
        state = new TrackedState(trackedStateContext, lastBlock);
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
        const lastBlock = await web3.eth.getBlockNumber();
        const mockState = new MockTrackedState(trackedStateContext, lastBlock, null);
        await mockState.initialize();
        const liquidator = new Liquidator(trackedStateContext, runner, liquidatorAddress, mockState, testNotifierTransports);
        expect(liquidator.address).to.eq(liquidatorAddress);
        await liquidator.runStep();
        expect(spyConsole).to.be.called.once;
    });

    it("Should not handle full liquidation - error", async () => {
        const spyConsole = spy.on(console, "error");
        // create actors
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress);
        const liquidator = new Liquidator(context, runner, liquidatorAddress, state, testNotifierTransports);
        const minter = await createTestMinter(context, liquidatorAddress, chain);
        // mint to liquidator address to be able to liquidate
        const crt = await minter.reserveCollateral(agent.vaultAddress, 200);
        const txHash0 = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash0);
        // change address to invoke error later
        expect(liquidator.address).to.eq(liquidatorAddress);
        await liquidator.handleFullLiquidationStarted(agent.vaultAddress);
        while (liquidator.runner.runningThreads > 0) {
            await sleep(2000);
        }
        expect(spyConsole).to.be.called.once;
    });
});
