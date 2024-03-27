/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { expect, spy, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import spies from "chai-spies";
import { InfoBotCommands } from "../../../src/commands/InfoBotCommands";
import { ORM } from "../../../src/config/orm";
import { MockChain } from "../../../src/mock/MockChain";
import { checkedCast, toBN } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { createTestOrm } from "../../../test/test-utils/test-bot-config";
import { TestAssetBotContext, createTestAssetContext } from "../../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../../test-utils/hardhat-test-helpers";
import { createTestAgent, createTestAgentAndMakeAvailable } from "../../test-utils/helpers";
use(chaiAsPromised);
use(spies);

const agentUnderlyingAddress = "agentUnderlyingAddress";

describe("InfoBot cli commands unit tests", () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let infoBot: InfoBotCommands;
    let chain: MockChain;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        // accounts
        ownerAddress = accounts[3];
    });

    async function initialize() {
        orm = await createTestOrm();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.blockchainIndexer.chain, MockChain);
        // chain tunning
        chain.finalizationBlocks = 0;
        chain.secondsPerBlock = 1;
        infoBot = new InfoBotCommands(context);
        return { orm, context, chain, infoBot };
    }

    beforeEach(async () => {
        ({ orm, context, chain, infoBot } = await loadFixtureCopyVars(initialize));
    });

    afterEach(function () {
        spy.restore(console);
    });

    it("Should get available agents and find best agent", async () => {
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress, agentUnderlyingAddress);
        // create agents
        for (let i = 0; i < 3; i++) {
            await createTestAgentAndMakeAvailable(context, ownerAddress, agentUnderlyingAddress + "_" + i);
        }
        const availableAgents = await infoBot.getAvailableAgents();
        expect(availableAgents[0].agentVault).to.eq(agent.vaultAddress);
        const findBestAgent = await infoBot.findBestAgent(toBN(1));
        expect(findBestAgent).to.not.be.undefined;
    });

    it("Should not find best agent", async () => {
        const findBestAgent = await infoBot.findBestAgent(toBN(1));
        expect(findBestAgent).to.be.undefined;
    });

    it("Should get all agents", async () => {
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress, agentUnderlyingAddress);
        // create agents
        for (let i = 0; i < 3; i++) {
            await createTestAgent(context, ownerAddress, agentUnderlyingAddress + "_" + i);
        }
        const agents = await infoBot.getAllAgents();
        expect(agents[0]).to.eq(agent.vaultAddress);
    });

    it("Should print system info", async () => {
        const spyLog = spy.on(console, "log");
        // create agents
        for (let i = 0; i < 3; i++) {
            await createTestAgentAndMakeAvailable(context, ownerAddress, agentUnderlyingAddress + "_" + i);
            await createTestAgent(context, ownerAddress, agentUnderlyingAddress + "_" + (100 + i));
        }
        await infoBot.printSystemInfo();
        expect(spyLog).to.be.called.gt(0);
    });

    it("Should print all and available agents", async () => {
        const spyLog = spy.on(console, "log");
        // create agents
        for (let i = 0; i < 3; i++) {
            await createTestAgentAndMakeAvailable(context, ownerAddress, agentUnderlyingAddress + "_" + i);
            await createTestAgent(context, ownerAddress, agentUnderlyingAddress + "_" + (100 + i));
        }
        await infoBot.printAllAgents();
        await infoBot.printAvailableAgents();
        expect(spyLog).to.be.called.gt(0);
    });

    it("Should print agent info", async () => {
        const spyLog = spy.on(console, "log");
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress, agentUnderlyingAddress);
        await infoBot.printAgentInfo(agent.vaultAddress);
        expect(spyLog).to.be.called.gt(0);
    });

    it("Should print pools", async () => {
        const spyLog = spy.on(console, "log");
        await createTestAgentAndMakeAvailable(context, ownerAddress, agentUnderlyingAddress);
        await infoBot.printPools();
        expect(spyLog).to.be.called.gt(0);
    });

    it("Should find pool by symbol", async () => {
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress, agentUnderlyingAddress);
        const symbol = await agent.collateralPoolToken.symbol();
        expect(await infoBot.findPoolBySymbol(symbol)).to.eq(agent.collateralPool.address);
        const invalidSymbol = "INVALID_POOL";
        await expect(infoBot.findPoolBySymbol(invalidSymbol)).to.eventually.be.rejectedWith(`Pool with token symbol ${invalidSymbol} does not exist.`);
    });

    it("Should print pool token balance", async () => {
        const spyLog = spy.on(console, "log");
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress, agentUnderlyingAddress);
        await infoBot.printPoolTokenBalance(agent.agentVault.address);
        await infoBot.printPoolTokenBalance(accounts[103]);
        expect(spyLog).to.be.called.exactly(3);
    });

    it("Should get pool token balance", async () => {
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress, agentUnderlyingAddress);
        const balance = await infoBot.getPoolTokenBalance(agent.collateralPool.address, agent.agentVault.address);
        expect(balance.gtn(0)).to.be.true;
    });
});
