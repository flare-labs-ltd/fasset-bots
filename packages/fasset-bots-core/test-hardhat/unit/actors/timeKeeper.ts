import { expect, spy, use } from "chai";
import spies from "chai-spies";
import { TimeKeeper } from "../../../src/actors/TimeKeeper";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { TestAssetBotContext, createTestAssetContext } from "../../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../../test-utils/hardhat-test-helpers";
use(spies);

describe("Time keeper unit tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let timeKeeperAddress: string;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        timeKeeperAddress = accounts[10];
    });

    async function initialize() {
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        context.blockchainIndexer.chain.finalizationBlocks = 0;
        return { context };
    }

    beforeEach(async () => {
        ({ context } = await loadFixtureCopyVars(initialize));
    });

    afterEach(function () {
        spy.restore(console);
    });

    it("Should create time keeper", async () => {
        const timeKeeper = new TimeKeeper(timeKeeperAddress, context, 60000);
        expect(timeKeeper.context.nativeChainInfo.finalizationBlocks).to.eq(context.nativeChainInfo.finalizationBlocks);
    });

    it("Should update underlying block", async () => {
        const currentBlock = await context.assetManager.currentUnderlyingBlock();
        expect(Number(currentBlock[0])).to.eq(0);
        const blocksToMine = 2;
        context.blockchainIndexer.chain.mine(blocksToMine);
        const timeKeeper = new TimeKeeper(timeKeeperAddress, context, 60000);
        await timeKeeper.updateUnderlyingBlock();
        const currentBlock2 = await context.assetManager.currentUnderlyingBlock();
        expect(Number(currentBlock2[0])).to.eq(blocksToMine);
    });

    it("Should not update underlying block - invalid timeKeeper's address", async () => {
        const spyConsole = spy.on(console, "error");
        const timeKeeper = new TimeKeeper("timeKeeperAddress", context, 60000);
        await timeKeeper.updateUnderlyingBlock();
        expect(spyConsole).to.be.called.once;
    });
});
