import { expect } from "chai";
import { AgentBot } from "../../../src/actors/AgentBot";
import { EM, ORM } from "../../../src/config/orm";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { AgentInfo, AssetManagerSettings } from "../../../src/fasset/AssetManagerTypes";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { MockChain } from "../../../src/mock/MockChain";
import { Prices } from "../../../src/state/Prices";
import { TrackedAgent } from "../../../src/state/TrackedAgent";
import { checkedCast, MAX_UINT256, toBN, toBNExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestOrmOptions } from "../../../test/utils/test-bot-config";
import { testChainInfo } from "../../../test/utils/TestChainInfo";
import { createTestAssetContext } from "../../utils/test-asset-context";

describe("Tracked agent tests", async () => {
    let accounts: string[];
    let context: IAssetBotContext; // due to ftsoManagerMock's mockFinalizePriceEpoch()
    let orm: ORM;
    let ownerAddress: string;
    let chain: MockChain;
    let agentBot: AgentBot;
    let trackedAgent: TrackedAgent;
    let agentInfo: AgentInfo;
    let settings: AssetManagerSettings;
    let prices: Prices;

    async function createTestAgentBot(rootEm: EM, context: IAssetBotContext, address: string): Promise<AgentBot> {
        const agentBot = await AgentBot.create(rootEm, context, address);
        await agentBot.agent.depositCollateral(toBNExp(100_000_000, 18));
        return agentBot;
    }

    async function createPrices(context: IAssetBotContext): Promise<Prices> {
        const { 0: natPrice, 1: natTimestamp } = await context.natFtso.getCurrentPrice();
        const { 0: assetPrice, 1: assetTimestamp } = await context.assetFtso.getCurrentPrice();
        return new Prices(settings, natPrice, natTimestamp, assetPrice, assetTimestamp);
    }

    before(async () => {
        accounts = await web3.eth.getAccounts();
        ownerAddress = accounts[3];
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp, false);
        chain = checkedCast(context.chain, MockChain);
        settings = await context.assetManager.getSettings();
        prices = await createPrices(context);
    });

    beforeEach(async () => {
        agentBot = await createTestAgentBot(orm.em, context, ownerAddress);
        trackedAgent = new TrackedAgent(agentBot.agent.vaultAddress, ownerAddress, agentBot.agent.underlyingAddress);
    });

    it("Should return collateral ratio", async () => {
        agentInfo = await context.assetManager.getAgentInfo(trackedAgent.vaultAddress);
        const cr = await trackedAgent.collateralRatioBIPS(settings, agentInfo, prices, prices);
        expect(cr.toString()).to.eq(MAX_UINT256.toString());
    });

    it("Should return agent status", async () => {
        await agentBot.agent.announceDestroy();
        agentInfo = await context.assetManager.getAgentInfo(trackedAgent.vaultAddress);
        const status = await trackedAgent.possibleLiquidationTransition(toBN(0), settings, agentInfo, prices, prices);
        expect(status.toString()).to.eq(agentInfo.status.toString());
    });

});

