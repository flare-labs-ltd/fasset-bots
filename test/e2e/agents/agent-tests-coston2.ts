import { FilterQuery } from "@mikro-orm/core/typings";
import { expect } from "chai";
import { AgentBot } from "../../../src/actors/AgentBot";
import { AgentBotRunner } from "../../../src/actors/AgentBotRunner";
import { Challenger } from "../../../src/actors/Challenger";
import { BotConfig } from "../../../src/config/BotConfig";
import { createAssetContext } from "../../../src/config/create-asset-context";
import { ORM } from "../../../src/config/orm";
import { ActorEntity, ActorType } from "../../../src/entities/actor";
import { AgentEntity } from "../../../src/entities/agent";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { TrackedState } from "../../../src/state/TrackedState";
import { ScopedRunner } from "../../../src/utils/events/ScopedRunner";
import { requireEnv } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
import { getSourceName, SourceId } from "../../../src/verification/sources/sources";
import { createTestOrm } from "../../test.mikro-orm.config";
import { createTestMinter, createTestRedeemer, getCoston2AccountsFromEnv } from "../../utils/test-actors";
import { createTestConfigNoMocks } from "../../utils/test-bot-config";

const costonRPCUrl: string = requireEnv('COSTON2_RPC_URL');
const CONTRACTS_JSON = "../fasset/deployment/deploys/coston2.json";
const sourceId = SourceId.XRP;

describe("Agent bot tests - coston2", async () => {
    let accounts: string[];
    let botConfig: BotConfig;
    let context: IAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let redeemerAddress: string;
    let challengerAddress: string;
    let runner: ScopedRunner;
    let state: TrackedState;

    before(async () => {
        accounts = await initWeb3(costonRPCUrl, getCoston2AccountsFromEnv(), null);
        ownerAddress = accounts[0];
        minterAddress = accounts[1];
        redeemerAddress = accounts[2];
        challengerAddress = accounts[3];
        orm = await createTestOrm({ schemaUpdate: 'recreate', dbName: 'fasset-bots-c2.db' });
        botConfig = await createTestConfigNoMocks([getSourceName(sourceId)!.toLocaleLowerCase()], orm.em, costonRPCUrl, CONTRACTS_JSON);
        context = await createAssetContext(botConfig, botConfig.chains[0]);
        runner = new ScopedRunner();
        state = new TrackedState();
    });

    it("Should create agent bot", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        expect(agentBot.agent.underlyingAddress).is.not.null;
        expect(agentBot.agent.ownerAddress).to.eq(ownerAddress);
    });

    it("Should create agent bot runner", async () => {
        const contexts: Map<number, IAssetBotContext> = new Map();
        contexts.set(context.chainInfo.chainId, context);
        const agentBotRunner = new AgentBotRunner(contexts, orm, 5);
        expect(agentBotRunner.loopDelay).to.eq(5);
        expect(agentBotRunner.contexts.get(context.chainInfo.chainId)).to.not.be.null;
    });

    it("Should create agent bot runner from bot config", async () => {
        const agentBotRunner = await AgentBotRunner.create(orm, botConfig)
        expect(agentBotRunner.loopDelay).to.eq(0);
        expect(agentBotRunner.contexts.get(context.chainInfo.chainId)).to.not.be.null;
    });

    it("Should create missing agents for agent bot runner", async () => {
        const agentBotRunner = await AgentBotRunner.create(orm, botConfig)
        expect(agentBotRunner.loopDelay).to.eq(0);
        expect(agentBotRunner.contexts.get(context.chainInfo.chainId)).to.not.be.null;
        await agentBotRunner.createMissingAgents(ownerAddress);
        const existing1 = await orm.em.count(AgentEntity, { chainId: context.chainInfo.chainId, active: true } as FilterQuery<AgentEntity>);
        expect(existing1).to.eq(1);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { active: true } as FilterQuery<AgentEntity>);
        agentEnt.active = false;
        await orm.em.persistAndFlush(agentEnt);
        const existing2 = await orm.em.count(AgentEntity, { chainId: context.chainInfo.chainId, active: true } as FilterQuery<AgentEntity>);
        expect(existing2).to.eq(0);
        await agentBotRunner.createMissingAgents(ownerAddress);
        const existing3 = await orm.em.count(AgentEntity, { chainId: context.chainInfo.chainId, active: true } as FilterQuery<AgentEntity>);
        expect(existing3).to.eq(1);
    });

    it("Should create minter", async () => {
        const minter = await createTestMinter(context, minterAddress);
        expect(minter.underlyingAddress).is.not.null;
        expect(minter.address).to.eq(minterAddress);
    });

    it("Should create redeemer", async () => {
        const redeemer = await createTestRedeemer(context, redeemerAddress);
        expect(redeemer.underlyingAddress).is.not.null;
        expect(redeemer.address).to.eq(redeemerAddress);
    });

    it("Should create challenger", async () => {
        const challenger = await Challenger.create(runner, orm.em, context, challengerAddress, state);
        expect(challenger.address).to.eq(challengerAddress);
    });

    it("Should read agent bot from entity", async () => {
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { ownerAddress: ownerAddress } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(context, agentEnt)
        expect(agentBot.agent.underlyingAddress).is.not.null;
        expect(agentBot.agent.ownerAddress).to.eq(ownerAddress);
    });

    it("Should read challenger from entity", async () => {
        const challengerEnt = await orm.em.findOneOrFail(ActorEntity, { address: challengerAddress, type: ActorType.CHALLENGER } as FilterQuery<ActorEntity>);
        const challenger = await Challenger.fromEntity(runner, context, challengerEnt, state);
        expect(challenger.address).to.eq(challengerAddress);
    });
});
