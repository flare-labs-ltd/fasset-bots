import { AgentBot } from "../../src/actors/AgentBot";
import { EM, ORM } from "../../src/config/orm";
import { Minter } from "../../src/mock/Minter";
import { MockChain } from "../../src/mock/MockChain";
import { checkedCast, toBNExp } from "../../src/utils/helpers";
import { web3 } from "../../src/utils/web3";
import { createTestOrm } from "../../test/test.mikro-orm.config";
import { createTestAssetContext } from "../utils/test-asset-context";
import { testChainInfo } from "../../test/utils/TestChainInfo";
import { IAssetBotContext } from "../../src/fasset-bots/IAssetBotContext";
import { FilterQuery } from "@mikro-orm/core/typings";
import { ActorEntity, ActorType } from "../../src/entities/actor";
import { disableMccTraceManager } from "../utils/helpers";
import { LiquidationTrigger } from "../../src/actors/LiquidationTrigger";
import { AgentEntity } from "../../src/entities/agent";

const minterUnderlying: string = "MINTER_ADDRESS";

describe("Liquidation trigger tests", async () => {
    let accounts: string[];
    let context: any; // due to ftsoManagerMock's mockFinalizePriceEpoch()
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let ccbTriggerAddress: string;
    let chain: MockChain;
    let agentBot: AgentBot;
    let minter: Minter;

    async function createTestLiquidationTrigger(rootEm: EM, context: IAssetBotContext, address: string) {
        const ccbTriggerEnt = await rootEm.findOne(ActorEntity, { address: address, type: ActorType.LIQUIDATION_TRIGGER } as FilterQuery<ActorEntity>);
        if (ccbTriggerEnt) {
            return await LiquidationTrigger.fromEntity(context, ccbTriggerEnt);
        } else {
            return await LiquidationTrigger.create(rootEm, context, address);
        }
    }

    async function createTestAgentBot(rootEm: EM, context: IAssetBotContext, address: string) {
        const agentEnt = await rootEm.findOne(AgentEntity, { ownerAddress: address } as FilterQuery<AgentEntity>);
        if (agentEnt) {
            return await AgentBot.fromEntity(context, agentEnt);
        } else {
            const agentBot =  await AgentBot.create(rootEm, context, address);
            await agentBot.agent.depositCollateral(toBNExp(100_000_000, 18));
            await agentBot.agent.makeAvailable(500, 3_0000);
            return agentBot;
        }
    }

    async function createCRAndPerformMinting(minter: Minter, agentBot: AgentBot, lots: number) {
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, lots);
        await agentBot.runStep(orm.em);
        const txHash0 = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash0);
        await agentBot.runStep(orm.em);
    }

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
        ownerAddress = accounts[3];
        minterAddress = accounts[4];
        ccbTriggerAddress = accounts[6];
        orm = await createTestOrm({ schemaUpdate: 'recreate' });
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp, false);
        chain = checkedCast(context.chain, MockChain);
        // chain tunning
        chain.finalizationBlocks = 0;
        chain.secondsPerBlock = 1;
        // actors
        agentBot = await createTestAgentBot(orm.em, context, ownerAddress);
        minter = await Minter.createTest(context, minterAddress, minterUnderlying, toBNExp(100_000, 18));
        chain.mine(chain.finalizationBlocks + 1);
    });

    it("Should check collateral ratio after minting execution", async () => {
        const ccbTrigger = await createTestLiquidationTrigger(orm.em, context, ccbTriggerAddress);
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 2);
        // check collateral ratio after minting execution
        await ccbTrigger.runStep(orm.em);
    });

    it("Should check collateral ratio after price changes", async () => {
        const ccbTrigger = await createTestLiquidationTrigger(orm.em, context, ccbTriggerAddress);
        // create collateral reservation and perform minting
        await context.ftsoManager.mockFinalizePriceEpoch();
        // check collateral ratio after price changes
        await ccbTrigger.runStep(orm.em);
    });

});