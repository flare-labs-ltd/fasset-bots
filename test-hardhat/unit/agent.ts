import { time } from "@openzeppelin/test-helpers";
import { assert, expect } from "chai";
import { AgentBot } from "../../src/actors/AgentBot";
import { ORM } from "../../src/config/orm";
import { Minter } from "../../src/mock/Minter";
import { MockChain } from "../../src/mock/MockChain";
import { Redeemer } from "../../src/mock/Redeemer";
import { checkedCast, toBN, toBNExp } from "../../src/utils/helpers";
import { web3 } from "../../src/utils/web3";
import { createTestOrm } from "../../test/test.mikro-orm.config";
import { createTestAssetContext } from "../utils/test-asset-context";
import { testChainInfo } from "../../test/utils/TestChainInfo";
import { IAssetBotContext } from "../../src/fasset-bots/IAssetBotContext";
import { FilterQuery } from "@mikro-orm/core";
import { AgentEntity } from "../../src/entities/agent";

describe("Agent bot unit tests", async () => {
    let accounts: string[];
    let context: IAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let redeemerAddress: string;
    let chain: MockChain;
    const minterUnderlyingAddress = "MINTER_ADDRESS";
    const redeemerUnderlyingAddress = "REDEEMER_ADDRESS";

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
    })

    it("Should create minter", async () => {
        const minter = await Minter.createTest(context, minterAddress, minterUnderlyingAddress, toBNExp(10_000, 6));
        expect(minter.address).to.eq(minterAddress);
        expect(minter.underlyingAddress).to.eq(minterUnderlyingAddress);
    })

    it("Should create redeemer", async () => {
        const redeemer = await Redeemer.create(context, redeemerAddress, redeemerUnderlyingAddress);
        expect(redeemer.address).to.eq(redeemerAddress);
        expect(redeemer.underlyingAddress).to.eq(redeemerUnderlyingAddress);
    })

    it("Should read agent from entity", async () => {
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { ownerAddress: ownerAddress } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(context, agentEnt)
        expect(agentBot.agent.underlyingAddress).is.not.null;
        expect(agentBot.agent.ownerAddress).to.eq(ownerAddress);
    });
});
