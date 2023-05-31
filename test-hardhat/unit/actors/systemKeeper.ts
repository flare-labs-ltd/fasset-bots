import { expect } from "chai";
import { SystemKeeper } from "../../../src/actors/SystemKeeper";
import { TrackedState } from "../../../src/state/TrackedState";
import { ScopedRunner } from "../../../src/utils/events/ScopedRunner";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { TestAssetTrackedStateContext, createTestAssetContext, getTestAssetTrackedStateContext } from "../../test-utils/create-test-asset-context";


describe("System keeper unit tests", async () => {
    let accounts: string[];
    let trackedStateContext: TestAssetTrackedStateContext;
    let systemKeeperAddress: string;
    let runner: ScopedRunner;
    let state: TrackedState;

    before(async () => {
        accounts = await web3.eth.getAccounts();
    });

    beforeEach(async () => {
        trackedStateContext = getTestAssetTrackedStateContext(await createTestAssetContext(accounts[0], testChainInfo.xrp));
        systemKeeperAddress = accounts[10];
        runner = new ScopedRunner();
        const lastBlock = await web3.eth.getBlockNumber();
        state = new TrackedState(trackedStateContext, lastBlock);
        await state.initialize();
    });

    it("Should create system keeper", async () => {
        const systemKeeper = new SystemKeeper(runner, systemKeeperAddress, state);
        expect(systemKeeper.address).to.eq(systemKeeperAddress);
    });

});