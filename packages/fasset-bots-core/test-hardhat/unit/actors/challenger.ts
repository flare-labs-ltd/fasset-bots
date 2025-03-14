import { expect, spy, use } from "chai";
import spies from "chai-spies";
import { MockTrackedState } from "../../../src/mock/MockTrackedState";
import { TrackedState } from "../../../src/state/TrackedState";
import { ITransaction } from "../../../src/underlying-chain/interfaces/IBlockChain";
import { toBN } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { TestAssetBotContext, TestAssetTrackedStateContext, createTestAssetContext, getTestAssetTrackedStateContext } from "../../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../../test-utils/hardhat-test-helpers";
import { assertWeb3DeepEqual, createTestAgent, createTestChallenger } from "../../test-utils/helpers";
use(spies);

const underlyingAddress: string = "AGENT_UNDERLYING_ADDRESS";
const transaction1 = {
    hash: "0x169781d915f549c9546305746e220c80df82304f5a496de47d10e3fefd54ebcb",
    inputs: [[underlyingAddress, toBN(100)]],
    outputs: [["someAddress", toBN(100)]],
    reference: "0x46425052664100030000000000000000000000000000000000000000000001df",
    status: 1,
} as ITransaction;
const transaction2 = {
    hash: "0x169781d915f549c9546305746e220c80df82304f5a496de47d10e3fefd54eAcb",
    inputs: [[underlyingAddress, toBN(100)]],
    outputs: [["someAddress", toBN(100)]],
    reference: "0x46425052664100030000000000000000000000000000000000000000000001df",
    status: 1,
} as ITransaction;

describe("Challenger unit tests", () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let trackedStateContext: TestAssetTrackedStateContext;
    let challengerAddress: string;
    let ownerAddress: string;
    let state: TrackedState;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        challengerAddress = accounts[10];
        ownerAddress = accounts[11];
    });

    async function initialize() {
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        trackedStateContext = getTestAssetTrackedStateContext(context);
        state = new TrackedState(trackedStateContext);
        await state.initialize();
        return { context, trackedStateContext, state };
    }

    beforeEach(async () => {
        ({ context, trackedStateContext, state } = await loadFixtureCopyVars(initialize));
    });

    afterEach(function () {
        spy.restore(console);
    });

    it("Should create challenger", async () => {
        const challenger = await createTestChallenger(trackedStateContext, challengerAddress, state);
        expect(challenger.address).to.eq(challengerAddress);
    });

    it("Should add unconfirmed transaction", async () => {
        const challenger = await createTestChallenger(trackedStateContext, challengerAddress, state);
        const agentB = await createTestAgent(context, ownerAddress, underlyingAddress);
        // create tracked agent
        const trackedAgent = await state.createAgentWithCurrentState(agentB.vaultAddress);
        // add transaction
        challenger.addUnconfirmedTransaction(trackedAgent, transaction1);
        // check
        const agentTransaction = challenger.unconfirmedTransactions.get(agentB.vaultAddress)!;
        assertWeb3DeepEqual(transaction1, agentTransaction.get(transaction1.hash));
    });

    it("Should delete unconfirmed transactions", async () => {
        const challenger = await createTestChallenger(trackedStateContext, challengerAddress, state);
        const agentB = await createTestAgent(context, ownerAddress, underlyingAddress);
        // create tracked agent
        const trackedAgent = await state.createAgentWithCurrentState(agentB.vaultAddress);
        // add transactions
        challenger.addUnconfirmedTransaction(trackedAgent, transaction1);
        challenger.addUnconfirmedTransaction(trackedAgent, transaction2);
        expect(challenger.unconfirmedTransactions.get(agentB.vaultAddress)).to.not.be.undefined;
        // delete transaction
        challenger.deleteUnconfirmedTransaction(agentB.vaultAddress, transaction1.hash);
        // check
        expect(challenger.unconfirmedTransactions.get(agentB.vaultAddress)).to.not.be.undefined;
        // delete transaction
        challenger.deleteUnconfirmedTransaction(agentB.vaultAddress, transaction2.hash);
        // check
        expect(challenger.unconfirmedTransactions.get(agentB.vaultAddress)).to.be.undefined;
    });

    it("Should not run step - error", async () => {
        const spyConsole = spy.on(console, "error");
        const mockState = new MockTrackedState(trackedStateContext, null);
        await mockState.initialize();
        const challenger = await createTestChallenger(trackedStateContext, challengerAddress, mockState);
        expect(challenger.address).to.eq(challengerAddress);
        await challenger.runStep();
        expect(spyConsole).to.be.called.once;
    });

    it("Should create challenger with explicitly stated default strategy", async () => {
        trackedStateContext = getTestAssetTrackedStateContext(context, true);
        state = new TrackedState(trackedStateContext);
        await state.initialize();
        const challenger = await createTestChallenger(trackedStateContext, challengerAddress, state);
        expect(challenger).to.not.be.undefined;
    });
});
