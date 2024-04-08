import { assert } from "chai";
import { AgentTokenConverter } from "../../../src";
import { Agent } from "../../../src/fasset/Agent";
import { MockChain } from "../../../src/mock/MockChain";
import { checkedCast, toBN, toBNExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { TestAssetBotContext, createTestAssetContext } from "../../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../../test-utils/hardhat-test-helpers";
import { createTestAgent } from "../../test-utils/helpers";

const underlyingAddress: string = "UNDERLYING_ADDRESS";

describe("Agent token converter unit tests", () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let ownerAddress: string;
    let chain: MockChain;
    let agent: Agent;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        ownerAddress = accounts[3];
    });

    async function initialize() {
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.blockchainIndexer.chain, MockChain);
        agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        return { context, chain, agent };
    }

    beforeEach(async () => {
        ({ context, chain, agent } = await loadFixtureCopyVars(initialize));
    });

    it("Should create agent token converter for fasset", async () => {
        const converter = new AgentTokenConverter(context, agent.agentVault.address, "fasset");
        const amount = await converter.parseToWei("3.15");
        assert.equal(amount.toString(), "3150000");
        const formatted = await converter.formatAsTokens(toBN(1234000), { decimals: 4, padRight: true });
        assert.equal(formatted, "1.2340");
        const formattedU = await converter.formatAsTokensWithUnit(toBN(1234000), { decimals: 4, padRight: true });
        assert.equal(formattedU, "1.2340 XRP");
    });

    it("Should create agent token converter for vault currency (testUSDC)", async () => {
        const converter = new AgentTokenConverter(context, agent.agentVault.address, "vault");
        const amount = await converter.parseToWei("3.15");
        assert.equal(amount.toString(), "3150000");
        const formatted = await converter.formatAsTokens(toBN(1234000), { decimals: 4, padRight: true });
        assert.equal(formatted, "1.2340");
        const formattedU = await converter.formatAsTokensWithUnit(toBN(1234000), { decimals: 4, padRight: true });
        assert.equal(formattedU, "1.2340 testUSDC");
    });

    it("Should create agent token converter for pool currency (CFLR)", async () => {
        const converter = new AgentTokenConverter(context, agent.agentVault.address, "pool");
        const amount = await converter.parseToWei("3.15");
        assert.equal(amount.toString(), "3150000000000000000");
        const formatted = await converter.formatAsTokens(toBNExp("1.234", 18), { decimals: 4, padRight: true });
        assert.equal(formatted, "1.2340");
        const formattedU = await converter.formatAsTokensWithUnit(toBNExp("1.234", 18), { decimals: 4, padRight: true });
        assert.equal(formattedU, "1.2340 WNAT");
    });
});
