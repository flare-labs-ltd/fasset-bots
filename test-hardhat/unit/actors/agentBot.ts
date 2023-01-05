import { expect } from "chai";
import { AgentBot } from "../../../src/actors/AgentBot";
import { ORM } from "../../../src/config/orm";
import { MockChain } from "../../../src/mock/MockChain";
import { checkedCast, toBN } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestOrm } from "../../../test/test.mikro-orm.config";
import { createTestAssetContext } from "../../utils/test-asset-context";
import { testChainInfo } from "../../../test/utils/TestChainInfo";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { FilterQuery } from "@mikro-orm/core";
import { AgentEntity, AgentMinting, AgentMintingState, AgentRedemption, AgentRedemptionState } from "../../../src/entities/agent";

describe("Agent bot unit tests", async () => {
    let accounts: string[];
    let context: IAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let redeemerAddress: string;
    let chain: MockChain;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        orm = await createTestOrm({ schemaUpdate: 'recreate' });
    });
    
    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.chain, MockChain);
        ownerAddress = accounts[3];
        minterAddress = accounts[4];
        redeemerAddress = accounts[5];
    });
    
    it("Should create agent", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        expect(agentBot.agent.ownerAddress).to.eq(ownerAddress);
        expect(agentBot.agent.underlyingAddress).to.not.be.null;
    });

    it("Should read agent from entity", async () => {
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { ownerAddress: ownerAddress } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(context, agentEnt)
        expect(agentBot.agent.underlyingAddress).is.not.null;
        expect(agentBot.agent.ownerAddress).to.eq(ownerAddress);
    });

    it("Should topup collateral", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        await agentBot.topupCollateral();
    });

    it("Should prove EOA address", async () => {
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp, true, true);
        await AgentBot.create(orm.em, context, ownerAddress);
    });

    it("Should not do next redemption step due to invalid redemption state", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        // create redemption with invalid state
        const rd = orm.em.create(AgentRedemption, {
            state: 'invalid' as AgentRedemptionState,
            agentAddress: "",
            requestId: "",
            paymentAddress: "",
            valueUBA: toBN(0),
            feeUBA: toBN(0),
            paymentReference: "",
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0)
        });
        await agentBot.nextRedemptionStep(orm.em, rd.id);
        await orm.em.persistAndFlush(rd);
        await agentBot.nextRedemptionStep(orm.em, rd.id);
    });

    it("Should not do next minting step due to invalid minting state", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        // create redemption with invalid state
        const mt = orm.em.create(AgentMinting, {
            state: 'invalid' as AgentMintingState,
            agentAddress: "",
            agentUnderlyingAddress: "",
            requestId: toBN(0),
            valueUBA: toBN(0),
            feeUBA: toBN(0),
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0),
            paymentReference: ""
        });
        await agentBot.nextMintingStep(orm.em, mt.id);
        await orm.em.persistAndFlush(mt);
        await agentBot.nextMintingStep(orm.em, mt.id);
    });

    it("Should return open redemptions", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        // create redemptions
        const rd1 = orm.em.create(AgentRedemption, {
            state: AgentRedemptionState.STARTED,
            agentAddress: "000",
            requestId: "000",
            paymentAddress: "",
            valueUBA: toBN(0),
            feeUBA: toBN(0),
            paymentReference: "",
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0)
        });
        const rd2 = orm.em.create(AgentRedemption, {
            state: AgentRedemptionState.DONE,
            agentAddress: "001",
            requestId: "001",
            paymentAddress: "",
            valueUBA: toBN(0),
            feeUBA: toBN(0),
            paymentReference: "",
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0)
        });
        await orm.em.persistAndFlush([rd1, rd2]);
        const ids = await agentBot.openRedemptions(orm.em, true);
        const rds = await agentBot.openRedemptions(orm.em, false);
        expect(ids.length).to.eq(1);
        expect(rds.length).to.eq(1);
    });
});
