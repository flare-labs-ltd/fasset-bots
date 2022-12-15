import { MockChain } from "../../../src/mock/MockChain";
import { checkedCast, toBN } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestAssetContext } from "../../utils/test-asset-context";
import { testChainInfo } from "../../../test/utils/TestChainInfo";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { expect } from "chai";

describe("Agent bot unit tests", async () => {
    let accounts: string[];
    let context: IAssetBotContext;
    let ownerAddress: string;
    let chain: MockChain;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.chain, MockChain);
    });

    beforeEach(async () => {
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.chain, MockChain);
        ownerAddress = accounts[3];
    });

    it("Should return round finalization", async () => {
        const round = 1;
        const finalized = await context.attestationProvider.roundFinalized(round);
        expect(finalized).to.be.false;
    });

    it("Should prove payment proof", async () => {
        const transaction = await context.wallet.addTransaction("UNDERLYING1", "UNDERLYING2", 1, null);
        chain.mine(chain.finalizationBlocks + 1);
        const provePayment = await context.attestationProvider.provePayment(transaction, "UNDERLYING1", "UNDERLYING2");
        expect(provePayment).to.not.be.null;
    });

    it("Should prove balance decreasing transaction proof", async () => {
        const transaction = await context.wallet.addTransaction("UNDERLYING1", "UNDERLYING2", 1, null);
        chain.mine(chain.finalizationBlocks + 1);
        const proveBalanceDecreasingTransaction = await context.attestationProvider.proveBalanceDecreasingTransaction(transaction, "UNDERLYING1");
        expect(proveBalanceDecreasingTransaction).to.not.be.null;
    });

    it("Should prove confirmed block height existence", async () => {
        chain.mine(chain.finalizationBlocks + 1);
        const requestConfirmedBlockHeight = await context.attestationProvider.proveConfirmedBlockHeightExists();
        expect(requestConfirmedBlockHeight).to.not.be.null;
    });

    it("Should prove referenced payment nonexistence", async () => {
        chain.mine(2 * chain.finalizationBlocks);
        const requestConfirmedBlockHeight = await context.attestationProvider.proveReferencedPaymentNonexistence("UNDERLYING2", "", toBN(1), 1, 1);
        expect(requestConfirmedBlockHeight).to.not.be.null;
    });

});