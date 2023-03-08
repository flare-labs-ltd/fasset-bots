import { FilterQuery } from "@mikro-orm/core/typings";
import { time } from "@openzeppelin/test-helpers";
import { assert, expect } from "chai";
import { readFileSync } from "fs";
import { AgentBot } from "../../../src/actors/AgentBot";
import { BotConfig, createBotConfig, RunConfig } from "../../../src/config/BotConfig";
import { createAssetContext } from "../../../src/config/create-asset-context";
import { ORM } from "../../../src/config/orm";
import { AgentEntity } from "../../../src/entities/agent";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { Minter } from "../../../src/mock/Minter";
import { MockChain } from "../../../src/mock/MockChain";
import { Redeemer } from "../../../src/mock/Redeemer";
import { checkedCast, systemTimestamp, toBN, toBNExp } from "../../../src/utils/helpers";
import { LOCAL_HARDHAT_RUN_CONFIG } from "../../test-utils/test-bot-config";
import { initTestWeb3 } from "../../test-utils/test-web3";

describe.skip("Agent bot tests - local network", async () => {
    let accounts: string[];
    let botConfig: BotConfig;
    let context: IAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let redeemerAddress: string;
    let chain: MockChain;
    let agentBot: AgentBot;
    let runConfig: RunConfig;

    before(async () => {
        runConfig = JSON.parse(readFileSync(LOCAL_HARDHAT_RUN_CONFIG).toString()) as RunConfig;
        accounts = await initTestWeb3();
        ownerAddress = accounts[3];
        minterAddress = accounts[4];
        redeemerAddress = accounts[5];
        botConfig = await createBotConfig(runConfig, ownerAddress);
        orm = botConfig.orm;
        context = await createAssetContext(botConfig, botConfig.chains[0]);
        chain = checkedCast(context.chain, MockChain);
    });

    it("Should create agent", async () => {
        agentBot = await AgentBot.create(orm.em, context, ownerAddress, botConfig.notifier);
        expect(agentBot.agent.underlyingAddress).is.not.null;
        expect(agentBot.agent.ownerAddress).to.eq(ownerAddress);
    })

    it("Should read agent from entity", async () => {
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { ownerAddress: ownerAddress } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(context, agentEnt, botConfig.notifier)
        expect(agentBot.agent.underlyingAddress).is.not.null;
        expect(agentBot.agent.ownerAddress).to.eq(ownerAddress);
    })

    it("Should perform minting and redemption", async () => {
        await agentBot.agent.depositCollateral(toBNExp(1_000_000, 18));
        await agentBot.agent.makeAvailable(500, 25000);
        const minter = await Minter.createTest(context, minterAddress, `MINTER_ADDRESS_${systemTimestamp()}`, toBNExp(10_000, 6)); // lot is 1000 XRP
        const redeemer = await Redeemer.create(context, redeemerAddress, `REDEEMER_ADDRESS_${systemTimestamp()}`);
        // perform minting
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);
        // transfer fassets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // request redemption
        const [rdReqs] = await redeemer.requestRedemption(2);
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
        // run agent's steps until redemption process is finished
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await agentBot.runStep(orm.em);
            // check if redemption is done
            orm.em.clear();
            const redemption = await agentBot.findRedemption(orm.em, rdReq.requestId);
            console.log(`Agent step ${i}, state = ${redemption.state}`)
            if (redemption.state === 'done') break;
        }
        // redeemer should now have some funds on the underlying chain
        const balance = await chain.getBalance(redeemer.underlyingAddress);
        assert.equal(String(balance), String(toBN(rdReq.valueUBA).sub(toBN(rdReq.feeUBA))));
    });
});
