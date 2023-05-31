import { expect } from "chai";
import { Liquidator } from "../../../src/actors/Liquidator";
import { TrackedState } from "../../../src/state/TrackedState";
import { ScopedRunner } from "../../../src/utils/events/ScopedRunner";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { TestAssetTrackedStateContext, createTestAssetContext, getTestAssetTrackedStateContext } from "../../test-utils/create-test-asset-context";


describe("Liquidator unit tests", async () => {
    let accounts: string[];
    let trackedStateContext: TestAssetTrackedStateContext;
    let liquidatorAddress: string;
    let runner: ScopedRunner;
    let state: TrackedState;

    before(async () => {
        accounts = await web3.eth.getAccounts();
    });

    beforeEach(async () => {
        trackedStateContext = getTestAssetTrackedStateContext(await createTestAssetContext(accounts[0], testChainInfo.xrp));
        liquidatorAddress = accounts[10];
        runner = new ScopedRunner();
        const lastBlock = await web3.eth.getBlockNumber();
        state = new TrackedState(trackedStateContext, lastBlock);
        await state.initialize();
    });

    it("Should create liquidator", async () => {
        const liquidator = new Liquidator(runner, liquidatorAddress, state);
        expect(liquidator.address).to.eq(liquidatorAddress);
    });

});