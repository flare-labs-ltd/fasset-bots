import { assert, expect } from "chai";
import { Agent } from "../../../src/fasset/Agent";
import { MockChain } from "../../../src/mock/MockChain";
import { Currencies } from "../../../src/utils";
import { checkedCast, toBN, toBNExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { TestAssetBotContext, createTestAssetContext } from "../../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../../test-utils/hardhat-test-helpers";
import { createTestAgent } from "../../test-utils/helpers";
import { CollateralType } from "../../../src/fasset/AssetManagerTypes";
import { POOL_TOKEN_DECIMALS } from "../../../test/test-utils/collateral-data/CollateralData";

const underlyingAddress: string = "UNDERLYING_ADDRESS";

describe("TokenBalance unit tests", () => {
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

    describe("Currencies", () => {
        it("Should create currency converter for fasset", async () => {
            const converter = await Currencies.fasset(context);
            const amount = converter.parse("3.15");
            assert.equal(amount.toString(), "3150000");
            const formatted = converter.formatValue(toBN(1234000), { decimals: 4, padRight: true });
            assert.equal(formatted, "1.2340");
            const formattedU = converter.format(toBN(1234000), { decimals: 4, padRight: true });
            assert.equal(formattedU, "1.2340 FXRP");
        });

        it("Should create currency converter for vault currency (testUSDC)", async () => {
            const converter = await Currencies.agentVaultCollateral(context, agent.agentVault.address);
            const amount = converter.parse("3.15");
            assert.equal(amount.toString(), "3150000");
            const formatted = converter.formatValue(toBN(1234000), { decimals: 4, padRight: true });
            assert.equal(formatted, "1.2340");
            const formattedU = converter.format(toBN(1234000), { decimals: 4, padRight: true });
            assert.equal(formattedU, "1.2340 testUSDC");
        });

        it("Should create currency converter for pool currency (CFLR)", async () => {
            const converter = await Currencies.agentPoolCollateral(context, agent.agentVault.address);
            const amount = converter.parse("3.15");
            assert.equal(amount.toString(), "3150000000000000000");
            const formatted = converter.formatValue(toBNExp("1.234", 18), { decimals: 4, padRight: true });
            assert.equal(formatted, "1.2340");
            const formattedU = converter.format(toBNExp("1.234", 18), { decimals: 4, padRight: true });
            assert.equal(formattedU, "1.2340 WNAT");
        });

        it("Should create tokens", async () => {
            const underlying = await Currencies.fassetUnderlyingToken(context);
            expect(underlying.symbol).to.eq(context.chainInfo.symbol);
            const pool = await Currencies.agentCollateralPoolToken(context, agent.vaultAddress);
            expect(pool.decimals).to.eq(POOL_TOKEN_DECIMALS);
        });
    });
});
