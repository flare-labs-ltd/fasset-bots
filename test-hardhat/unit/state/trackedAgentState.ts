import { expect } from "chai";
import { AgentBot, AgentStatus } from "../../../src/actors/AgentBot";
import { EM, ORM } from "../../../src/config/orm";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { AgentInfo, AssetManagerSettings } from "../../../src/fasset/AssetManagerTypes";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { TrackedAgentState } from "../../../src/state/TrackedAgentState";
import { TrackedState } from "../../../src/state/TrackedState";
import { MAX_UINT256, toBN, toBNExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { createTestAssetContext } from "../../test-utils/test-asset-context";

describe("Tracked agent state tests", async () => {
    let accounts: string[];
    let context: IAssetBotContext; // due to ftsoManagerMock's mockFinalizePriceEpoch()
    let orm: ORM;
    let ownerAddress: string;
    let agentBot: AgentBot;
    let trackedAgentState: TrackedAgentState;
    let trackedState: TrackedState;
    let agentInfo: AgentInfo;
    let settings: AssetManagerSettings;

    async function createTestAgentBot(rootEm: EM, context: IAssetBotContext, address: string): Promise<AgentBot> {
        const agentBot = await AgentBot.create(rootEm, context, address);
        await agentBot.agent.depositCollateral(toBNExp(100_000_000, 18));
        return agentBot;
    }

    before(async () => {
        accounts = await web3.eth.getAccounts();
        ownerAddress = accounts[3];
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        settings = await context.assetManager.getSettings();
    });

    beforeEach(async () => {
        agentBot = await createTestAgentBot(orm.em, context, ownerAddress);
        const lastBlock = await web3.eth.getBlockNumber();
        trackedState = new TrackedState(context, lastBlock);
        await trackedState.initialize();
        trackedAgentState = new TrackedAgentState(trackedState, agentBot.agent.vaultAddress, ownerAddress, agentBot.agent.underlyingAddress);
    });

    it("Should return collateral ratio", async () => {
        agentInfo = await context.assetManager.getAgentInfo(trackedAgentState.vaultAddress);
        const cr = await trackedAgentState.collateralRatioBIPS();
        expect(cr.toString()).to.eq(MAX_UINT256.toString());
    });

    it("Should return agent status", async () => {
        trackedAgentState.status = AgentStatus.DESTROYING;
        const status = await trackedAgentState.possibleLiquidationTransition(toBN(0));
        expect(status.toString()).to.eq(trackedAgentState.status.toString());
    });

});