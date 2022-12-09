import { expect } from "chai";
import { Minter } from "../../src/mock/Minter";
import { MockChain } from "../../src/mock/MockChain";
import { checkedCast, toBNExp } from "../../src/utils/helpers";
import { web3 } from "../../src/utils/web3";
import { createTestAssetContext } from "../utils/test-asset-context";
import { testChainInfo } from "../../test/utils/TestChainInfo";
import { IAssetBotContext } from "../../src/fasset-bots/IAssetBotContext";

describe("Minter unit tests", async () => {
    let accounts: string[];
    let context: IAssetBotContext;
    let minterAddress: string;
    let chain: MockChain;
    const minterUnderlyingAddress = "MINTER_ADDRESS";

    before(async () => {
        accounts = await web3.eth.getAccounts();
    });
    
    beforeEach(async () => {
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.chain, MockChain);
        minterAddress = accounts[4];
    });

    it("Should create minter", async () => {
        const minter = await Minter.createTest(context, minterAddress, minterUnderlyingAddress, toBNExp(10_000, 6));
        expect(minter.address).to.eq(minterAddress);
        expect(minter.underlyingAddress).to.eq(minterUnderlyingAddress);
    })

});
