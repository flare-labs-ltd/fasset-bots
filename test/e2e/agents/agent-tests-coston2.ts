import { FilterQuery } from "@mikro-orm/core/typings";
import { expect } from "chai";
import { readFileSync } from "fs";
import { AgentBot } from "../../../src/actors/AgentBot";
import { AgentBotRunner } from "../../../src/actors/AgentBotRunner";
import { Challenger } from "../../../src/actors/Challenger";
import { BotConfig, createBotConfig, RunConfig } from "../../../src/config/BotConfig";
import { createAssetContext } from "../../../src/config/create-asset-context";
import { ORM } from "../../../src/config/orm";
import { AgentEntity } from "../../../src/entities/agent";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { TrackedState } from "../../../src/state/TrackedState";
import { ScopedRunner } from "../../../src/utils/events/ScopedRunner";
import { requireEnv } from "../../../src/utils/helpers";
import { Notifier } from "../../../src/utils/Notifier";
import { initWeb3, web3 } from "../../../src/utils/web3";
import { getCoston2AccountsFromEnv } from "../../test-utils/test-actors";
import { COSTON2_RUN_CONFIG_CONTRACTS } from "../../test-utils/test-bot-config";

const RPC_URL: string = requireEnv('RPC_URL');

describe("Agent bot tests - coston2", async () => {
    let accounts: string[];
    let botConfig: BotConfig;
    let context: IAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let challengerAddress: string;
    let runner: ScopedRunner;
    let state: TrackedState;
    let runConfig: RunConfig;

    before(async () => {
        runConfig = JSON.parse(readFileSync(COSTON2_RUN_CONFIG_CONTRACTS).toString()) as RunConfig;
        accounts = await initWeb3(RPC_URL, getCoston2AccountsFromEnv(), null);
        ownerAddress = accounts[0];
        challengerAddress = accounts[3];
        botConfig = await createBotConfig(runConfig);
        orm = botConfig.orm;
    });

    beforeEach(async () => {
        context = await createAssetContext(botConfig, botConfig.chains[0]);
        runner = new ScopedRunner();
        const lastBlock = await web3.eth.getBlockNumber();
        state = new TrackedState(context, lastBlock);
        await state.initialize();
    });

    it("Should create agent bot", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress, new Notifier());
        expect(agentBot.agent.underlyingAddress).is.not.null;
        expect(agentBot.agent.ownerAddress).to.eq(ownerAddress);
    });

    it("Should create agent bot runner", async () => {
        const contexts: Map<number, IAssetBotContext> = new Map();
        contexts.set(context.chainInfo.chainId, context);
        const agentBotRunner = new AgentBotRunner(contexts, orm, 5, new Notifier());
        expect(agentBotRunner.loopDelay).to.eq(5);
        expect(agentBotRunner.contexts.get(context.chainInfo.chainId)).to.not.be.null;
    });

    it("Should create agent bot runner from bot config", async () => {
        const agentBotRunner = await AgentBotRunner.create(botConfig)
        expect(agentBotRunner.loopDelay).to.eq(runConfig.loopDelay);
        expect(agentBotRunner.contexts.get(context.chainInfo.chainId)).to.not.be.null;
    });

    it("Should create missing agents for agent bot runner", async () => {
        const agentBotRunner = await AgentBotRunner.create(botConfig)
        expect(agentBotRunner.loopDelay).to.eq(runConfig.loopDelay);
        expect(agentBotRunner.contexts.get(context.chainInfo.chainId)).to.not.be.null;
        await agentBotRunner.createMissingAgents(ownerAddress);
        const existing1 = await orm.em.count(AgentEntity, { chainId: context.chainInfo.chainId, active: true } as FilterQuery<AgentEntity>);
        expect(existing1).to.gte(1);
    });

    it("Should create challenger", async () => {
        const challenger = new Challenger(runner, challengerAddress, state, await context.chain.getBlockHeight());
        expect(challenger.address).to.eq(challengerAddress);
    });

    it("Should read agent bot from entity", async () => {
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { ownerAddress: ownerAddress } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(context, agentEnt, new Notifier())
        expect(agentBot.agent.underlyingAddress).is.not.null;
        expect(agentBot.agent.ownerAddress).to.eq(ownerAddress);
    });

});