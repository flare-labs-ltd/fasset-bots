import { expect } from "chai";
import { Minter } from "../../../src/mock/Minter";
import { MockChain } from "../../../src/mock/MockChain";
import { checkedCast, toBNExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { TestAssetBotContext, createTestAssetContext } from "../../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../../test-utils/hardhat-test-helpers";

describe("Minter unit tests", () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let minterAddress: string;
    let chain: MockChain;
    const minterUnderlyingAddress = "MINTER_ADDRESS";

    before(async () => {
        accounts = await web3.eth.getAccounts();
        minterAddress = accounts[4];
    });

    async function initialize() {
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.blockchainIndexer.chain, MockChain);
        return { context, chain };
    }

    beforeEach(async () => {
        ({ context, chain } = await loadFixtureCopyVars(initialize));
    });

    it("Should create minter", async () => {
        const minter = await Minter.createTest(context, minterAddress, minterUnderlyingAddress, toBNExp(10_000, 6));
        expect(minter.address).to.eq(minterAddress);
        expect(minter.underlyingAddress).to.eq(minterUnderlyingAddress);
    });

    it("Should perform payment", async () => {
        const minter = await Minter.createTest(context, minterAddress, minterUnderlyingAddress, toBNExp(10_000, 6));
        const txHash = await minter.performPayment("ADDRESS", 1);
        const getTx = await chain.getTransaction(txHash);
        expect(txHash).to.eq(getTx?.hash);
    });
});
