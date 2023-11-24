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
import { checkedCast } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo, testNativeChainInfo } from "../../../test/test-utils/TestChainInfo";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
import { TestAssetBotContext, createTestAssetContext } from "../../test-utils/create-test-asset-context";
import { createTestAgent, createTestAgentAndMakeAvailable } from "../../test-utils/helpers";
import { BotConfigFile } from "../../../src/config/config-files";
use(chaiAsPromised);
use(spies);

const agentUnderlyingAddress = "agentUnderlyingAddress";
const userUnderlyingAddress = "userUnderlyingAddress";

describe("Bot cli commands unit tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let infoBot: InfoBot;
    let chain: MockChain;
    let agent: Agent;

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
                },
            ],
            nativeChainInfo: testNativeChainInfo,
            addressUpdater: "",
        };
        infoBot = new InfoBot(context, config, config.fAssetInfos[0]);
        agent = await createTestAgentAndMakeAvailable(context, ownerAddress, agentUnderlyingAddress);
    });

    afterEach(function () {
        spy.restore(console);
    });

    it("Should get available agents", async () => {
        // create agents
        for (let i = 0; i <= 10; i++) {
            await createTestAgentAndMakeAvailable(context, ownerAddress, agentUnderlyingAddress + "_" + i);
        }
        const availableAgents = await infoBot.getAvailableAgents();
        expect(availableAgents[0].agentVault).to.eq(agent.vaultAddress);
    });

    it("Should get all agents", async () => {
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
});
