/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { expect, spy, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import spies from "chai-spies";
import { InfoBot } from "../../../src/actors/InfoBot";
import { ORM } from "../../../src/config/orm";
import { Agent } from "../../../src/fasset/Agent";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { MockChain } from "../../../src/mock/MockChain";
import { SourceId } from "../../../src/underlying-chain/SourceId";
import { checkedCast, toBN } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo, testNativeChainInfo } from "../../../test/test-utils/TestChainInfo";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
import { TestAssetBotContext, createTestAssetContext } from "../../test-utils/create-test-asset-context";
import { createTestAgent, createTestAgentAndMakeAvailable } from "../../test-utils/helpers";
import { BotConfigFile } from "../../../src/config/config-files";
use(chaiAsPromised);
use(spies);

const agentUnderlyingAddress = "agentUnderlyingAddress";

describe("InfoBot cli commands unit tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let infoBot: InfoBot;
    let chain: MockChain;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: "recreate", type: "sqlite" }));
        // accounts
        ownerAddress = accounts[3];
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.blockchainIndexer.chain, MockChain);
        // chain tunning
        chain.finalizationBlocks = 0;
        chain.secondsPerBlock = 1;
        // user bot
        const chainId = SourceId.testXRP;
        const config: BotConfigFile = {
            rpcUrl: "",
            loopDelay: 0,
            fAssetInfos: [
                {
                    chainId: chainId,
                    name: "Ripple",
                    symbol: "XRP",
                    decimals: 6,
                    amgDecimals: 0,
                    requireEOAProof: false,
                    finalizationBlocks: 6,
                    walletUrl: "walletUrl",
                },
            ],
            nativeChainInfo: testNativeChainInfo,
            addressUpdater: "",
        };
        infoBot = new InfoBot(context, config, config.fAssetInfos[0]);
    });

    afterEach(function () {
        spy.restore(console);
    });

    it("Should get available agents and find best agent", async () => {
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress, agentUnderlyingAddress);
        // create agents
        for (let i = 0; i <= 10; i++) {
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
        for (let i = 0; i <= 10; i++) {
            await createTestAgent(context, ownerAddress, agentUnderlyingAddress + "_" + i);
        }
        const agents = await infoBot.getAllAgents();
        expect(agents[0]).to.eq(agent.vaultAddress);
    });

    it("Should print system info", async () => {
        const spyLog = spy.on(console, "log");
        // create agents
        for (let i = 0; i <= 5; i++) {
            await createTestAgentAndMakeAvailable(context, ownerAddress, agentUnderlyingAddress + "_" + i);
            await createTestAgent(context, ownerAddress, agentUnderlyingAddress + "_" + (i + 1));
        }
        await infoBot.printSystemInfo();
        expect(spyLog).to.be.called.gt(0);
    });

    it("Should print all and available agents", async () => {
        const spyLog = spy.on(console, "log");
        // create agents
        for (let i = 0; i <= 5; i++) {
            await createTestAgentAndMakeAvailable(context, ownerAddress, agentUnderlyingAddress + "_" + i);
            await createTestAgent(context, ownerAddress, agentUnderlyingAddress + "_" + i + 1);
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

    it("Should generate secrets", async () => {
        const agent = infoBot.generateSecrets(["agent"]);
        expect(agent).to.not.be.empty;
        const other = infoBot.generateSecrets(["other"]);
        expect(other).to.not.be.empty;
        const user = infoBot.generateSecrets(["user"]);
        expect(user).to.not.be.empty;
    });

    it("Should find pool by symbol", async () => {
        const suffix = "POOL-TKN-TEST";
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress, agentUnderlyingAddress, suffix);
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
