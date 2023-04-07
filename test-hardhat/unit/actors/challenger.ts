import { expect } from "chai";
import { ORM } from "../../../src/config/orm";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { TrackedState } from "../../../src/state/TrackedState";
import { ITransaction } from "../../../src/underlying-chain/interfaces/IBlockChain";
import { toBN } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { assertWeb3DeepEqual, createTestAgentB, createTestChallenger } from "../../test-utils/helpers";
import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/create-test-asset-context";

const underlyingAddress: string = "AGENT_UNDERLYING";
const transaction1 = {
    hash: '0x169781d915f549c9546305746e220c80df82304f5a496de47d10e3fefd54ebcb',
    inputs: [[underlyingAddress, toBN(100)]],
    outputs: [['someAddress', toBN(100)]],
    reference: '0x46425052664100030000000000000000000000000000000000000000000001df',
    status: 1
} as ITransaction;
const transaction2 = {
    hash: '0x169781d915f549c9546305746e220c80df82304f5a496de47d10e3fefd54eAcb',
    inputs: [[underlyingAddress, toBN(100)]],
    outputs: [['someAddress', toBN(100)]],
    reference: '0x46425052664100030000000000000000000000000000000000000000000001df',
    status: 1
} as ITransaction;

describe("Challenger unit tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let challengerAddress: string;
    let ownerAddress: string;
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
        challengerAddress = accounts[10];
        ownerAddress = accounts[11];
    });

    it("Should create challenger", async () => {
        const challenger = await createTestChallenger(challengerAddress, state, context);
        expect(challenger.address).to.eq(challengerAddress);
    });

    it("Should add unconfirmed transaction", async () => {
        const challenger = await createTestChallenger(challengerAddress, state, context);
        const agentB = await createTestAgentB(context, ownerAddress, underlyingAddress);
        // create tracked agent
        const trackedAgent = await state.createAgentWithCurrentState(agentB.vaultAddress);
        // add transaction
        challenger.addUnconfirmedTransaction(trackedAgent, transaction1);
        // check
        const agentTransaction = challenger.unconfirmedTransactions.get(agentB.vaultAddress)!;
        assertWeb3DeepEqual(transaction1, agentTransaction.get((transaction1.hash)));
    });

    it("Should delete unconfirmed transactions", async () => {
        const challenger = await createTestChallenger(challengerAddress, state, context);
        const agentB = await createTestAgentB(context, ownerAddress, underlyingAddress);
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

});