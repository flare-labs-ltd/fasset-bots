import { expect } from "chai";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { MockChain } from "../../../src/mock/MockChain";
import { Redeemer } from "../../../src/mock/Redeemer";
import { checkedCast } from "../../../src/utils/helpers";
import { createTestAssetContext } from "../../utils/test-asset-context";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/utils/TestChainInfo";

describe("Redeemer unit tests", async () => {
    let accounts: string[];
    let context: IAssetBotContext;
    let redeemerAddress: string;
    let chain: MockChain;
    const redeemerUnderlyingAddress = "REDEEMER_ADDRESS";

    before(async () => {
        accounts = await web3.eth.getAccounts();
    });
    
    beforeEach(async () => {
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.chain, MockChain);
        redeemerAddress = accounts[5];
    });
    
    it("Should create redeemer", async () => {
        const redeemer = await Redeemer.create(context, redeemerAddress, redeemerUnderlyingAddress);
        expect(redeemer.address).to.eq(redeemerAddress);
        expect(redeemer.underlyingAddress).to.eq(redeemerUnderlyingAddress);
    });

});
