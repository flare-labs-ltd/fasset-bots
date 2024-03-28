import { expect } from "chai";
import { IAssetAgentContext } from "../../../src/fasset-bots/IAssetBotContext";
import { Redeemer } from "../../../src/mock/Redeemer";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { createTestAssetContext } from "../../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../../test-utils/hardhat-test-helpers";

describe("Redeemer unit tests", () => {
    let accounts: string[];
    let context: IAssetAgentContext;
    let redeemerAddress: string;
    const redeemerUnderlyingAddress = "REDEEMER_ADDRESS";

    before(async () => {
        accounts = await web3.eth.getAccounts();
        redeemerAddress = accounts[5];
    });

    async function initialize() {
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        return { context };
    }

    beforeEach(async () => {
        ({ context } = await loadFixtureCopyVars(initialize));
    });

    it("Should create redeemer", async () => {
        const redeemer = await Redeemer.create(context, redeemerAddress, redeemerUnderlyingAddress);
        expect(redeemer.address).to.eq(redeemerAddress);
        expect(redeemer.underlyingAddress).to.eq(redeemerUnderlyingAddress);
    });
});
