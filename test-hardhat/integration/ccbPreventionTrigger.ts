import { AgentBot } from "../../src/actors/AgentBot";
import { EM, ORM } from "../../src/config/orm";
import { Minter } from "../../src/mock/Minter";
import { MockChain } from "../../src/mock/MockChain";
import { checkedCast, toBNExp } from "../../src/utils/helpers";
import { web3 } from "../../src/utils/web3";
import { createTestOrm } from "../../test/test.mikro-orm.config";
import { createTestAssetContext, TestAssetBotContext } from "../utils/test-asset-context";
import { testChainInfo } from "../../test/utils/TestChainInfo";
import { IAssetBotContext } from "../../src/fasset-bots/IAssetBotContext";
import { FilterQuery } from "@mikro-orm/core/typings";
import { ActorEntity, ActorType } from "../../src/entities/actor";
import { disableMccTraceManager } from "../utils/helpers";
import { CcbPreventionTrigger } from "../../src/actors/CcbPreventionTrigger";
import { AgentEntity } from "../../src/entities/agent";

const minterUnderlying: string = "MINTER_ADDRESS";

describe("Collateral call band trigger tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let ccbTriggerAddress: string;
    let chain: MockChain;
    let agentBot: AgentBot;
    let minter: Minter;

    async function createTestCcbTrigger(rootEm: EM, context: IAssetBotContext, address: string) {
        const ccbTriggerEnt = await rootEm.findOne(ActorEntity, { address: address, type: ActorType.CCB_PREVENTION_TRIGGER } as FilterQuery<ActorEntity>);
        if (ccbTriggerEnt) {
            return await CcbPreventionTrigger.fromEntity(context, ccbTriggerEnt);
        } else {
            return await CcbPreventionTrigger.create(rootEm, context, address);
        }
    }

    async function createTestAgentBot(rootEm: EM, context: IAssetBotContext, address: string) {
        const agentEnt = await rootEm.findOne(AgentEntity, { ownerAddress: address } as FilterQuery<AgentEntity>);
        if (agentEnt) {
            return await AgentBot.fromEntity(context, agentEnt);
        } else {
            const agentBot = await AgentBot.create(rootEm, context, address);
            await agentBot.agent.depositCollateral(toBNExp(100_000_000, 18));
            await agentBot.agent.makeAvailable(500, 3_0000);
            return agentBot;
        }
    }

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
        ownerAddress = accounts[3];
        minterAddress = accounts[4];
        ccbTriggerAddress = accounts[6];
        orm = await createTestOrm({ schemaUpdate: 'recreate' });
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp, false);
        chain = checkedCast(context.chain, MockChain);
        // chain tunning
        chain.finalizationBlocks = 0;
        chain.secondsPerBlock = 1;
    });

    beforeEach(async () => {
        orm.em.clear();
        // actors
        agentBot = await createTestAgentBot(orm.em, context, ownerAddress);
        minter = await Minter.createTest(context, minterAddress, minterUnderlying, toBNExp(100_000, 18));
        chain.mine(chain.finalizationBlocks + 1);
    });

    it("Should check collateral ratio after price changes", async () => {
        const ccbTrigger = await createTestCcbTrigger(orm.em, context, ccbTriggerAddress);
        // mock price changes
        await context.ftsoManager.mockFinalizePriceEpoch();
        // check collateral ratio after price changes
        await ccbTrigger.runStep(orm.em);
    });

    it("Should check collateral ratio after price changes 2", async () => {
        const ccbTrigger = await createTestCcbTrigger(orm.em, context, ccbTriggerAddress);
        // create collateral reservation
        await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        // change price
        const { 0: assetPrice } = await context.assetFtso.getCurrentPrice();
        await context.assetFtso.setCurrentPrice(assetPrice.muln(10000), 0);
        // mock price changes
        await context.ftsoManager.mockFinalizePriceEpoch();
        // check collateral ratio after price changes
        await ccbTrigger.runStep(orm.em);
    });
});