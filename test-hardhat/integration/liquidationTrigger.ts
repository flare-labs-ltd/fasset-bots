import { AgentBot, AgentStatus } from "../../src/actors/AgentBot";
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
import { LiquidationTrigger } from "../../src/actors/LiquidationTrigger";
import { AgentEntity, AgentMintingState } from "../../src/entities/agent";
import { assert } from "chai";

const minterUnderlying: string = "MINTER_ADDRESS";

describe("Liquidation trigger tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext; // due to ftsoManagerMock's mockFinalizePriceEpoch()
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let liquidationTriggerAddress: string;
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
            const agentBot = await AgentBot.create(rootEm, context, address);
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
        liquidationTriggerAddress = accounts[6];
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

    it("Should check collateral ratio after minting execution", async () => {
        const liquidationTrigger = await createTestLiquidationTrigger(orm.em, context, liquidationTriggerAddress);
        await liquidationTrigger.initialize();
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 2);
        // check collateral ratio after minting execution
        await liquidationTrigger.runStep(orm.em);
    });

    it("Should check collateral ratio after price changes", async () => {
        const liquidationTrigger = await createTestLiquidationTrigger(orm.em, context, liquidationTriggerAddress);
        await liquidationTrigger.initialize();
        // mock price changes
        await context.ftsoManager.mockFinalizePriceEpoch();
        // check collateral ratio after price changes
        await liquidationTrigger.runStep(orm.em);
    });

    it("Should check collateral ratio after price changes 2", async () => {
        const liquidationTrigger = await createTestLiquidationTrigger(orm.em, context, liquidationTriggerAddress);
        await liquidationTrigger.initialize();
        // create collateral reservation
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        // should have an open minting
        orm.em.clear();
        const mintings = await agentBot.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const minting = mintings[0];
        assert.equal(minting.state, AgentMintingState.STARTED);
        // pay for and execute minting
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);
        // the minting status should now be 'done'
        orm.em.clear();
        const openMintingsAfter = await agentBot.openMintings(orm.em, false);
        assert.equal(openMintingsAfter.length, 0);
        const mintingAfter = await agentBot.findMinting(orm.em, minting.requestId);
        assert.equal(mintingAfter.state, AgentMintingState.DONE);
        // check status in agent bot entity
        const agentBotEnt = await orm.em.findOne(AgentEntity, { vaultAddress: agentBot.agent.agentVault.address, } as FilterQuery<AgentEntity>);
        assert.equal(agentBotEnt?.status, AgentStatus.NORMAL);
        // change price
        const { 0: assetPrice } = await context.assetFtso.getCurrentPrice();
        await context.assetFtso.setCurrentPrice(assetPrice.muln(10000), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await liquidationTrigger.runStep(orm.em);
        // handle status change and entity
        await agentBot.runStep(orm.em);
        assert.equal(agentBotEnt?.status, AgentStatus.LIQUIDATION);
        // change price back
        const { 0: assetPrice2 } = await context.assetFtso.getCurrentPrice();
        await context.assetFtso.setCurrentPrice(assetPrice2.divn(10000), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await liquidationTrigger.runStep(orm.em);
        // handle status change and entity
        await agentBot.runStep(orm.em);
        assert.equal(agentBotEnt?.status, AgentStatus.NORMAL);
    });

});