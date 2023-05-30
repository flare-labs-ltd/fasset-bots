import { expect } from "chai";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { TestAssetBotContext, createTestAssetContext } from "../../test-utils/create-test-asset-context";
import { TimeKeeper } from "../../../src/actors/TimeKeeper";


describe("Time keeper unit tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        context.chain.finalizationBlocks = 0;
    });

    it("Should create time keeper", async () => {
        const timeKeeper = new TimeKeeper(context);
        expect(timeKeeper.context.chainInfo.chainId).to.eq(context.chainInfo.chainId);
    });

    it("Should update underlying block", async () => {
        const currentBlock = await context.assetManager.currentUnderlyingBlock();
        expect(Number(currentBlock[0])).to.eq(0);
        const blocksToMine = 2;
        context.chain.mine(blocksToMine);
        const timeKeeper = new TimeKeeper(context);
        await timeKeeper.updateUnderlyingBlock();
        const currentBlock2 = await context.assetManager.currentUnderlyingBlock();
        expect(Number(currentBlock2[0])).to.eq(blocksToMine);
    });

});