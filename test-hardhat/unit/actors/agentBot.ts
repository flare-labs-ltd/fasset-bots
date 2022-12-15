import { expect } from "chai";
import { AgentBot } from "../../../src/actors/AgentBot";
import { ORM } from "../../../src/config/orm";
import { MockChain } from "../../../src/mock/MockChain";
import { checkedCast } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestOrm } from "../../../test/test.mikro-orm.config";
import { createTestAssetContext } from "../../utils/test-asset-context";
import { testChainInfo } from "../../../test/utils/TestChainInfo";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { FilterQuery } from "@mikro-orm/core";
import { AgentEntity } from "../../../src/entities/agent";

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

    it("Should prove EOA address", async () => {
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp, true);
        await AgentBot.create(orm.em, context, ownerAddress);
    });

    it("Should topup collateral - liquidation", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        await agentBot.topupCollateral("liquidation");
    });

    it("Should topup collateral - ccb", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        await agentBot.topupCollateral("ccb");
    });

    it("Should topup collateral - trigger", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        await agentBot.topupCollateral("trigger");
    });
    
});
