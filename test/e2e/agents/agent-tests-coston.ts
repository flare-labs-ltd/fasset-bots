import { FilterQuery } from "@mikro-orm/core/typings";
import { expect } from "chai";
import { readFileSync } from "fs";
import { AgentBot } from "../../../src/actors/AgentBot";
import { AgentBotRunner } from "../../../src/actors/AgentBotRunner";
import { Challenger } from "../../../src/actors/Challenger";
import { AgentBotConfig, AgentBotRunConfig, createAgentBotConfig } from "../../../src/config/BotConfig";
import { createAssetContext } from "../../../src/config/create-asset-context";
import { ORM } from "../../../src/config/orm";
import { AgentEntity } from "../../../src/entities/agent";
import { IAssetAgentBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { TrackedState } from "../../../src/state/TrackedState";
import { ScopedRunner } from "../../../src/utils/events/ScopedRunner";
import { requireEnv } from "../../../src/utils/helpers";
import { Notifier } from "../../../src/utils/Notifier";
import { initWeb3, web3 } from "../../../src/utils/web3";
import { createTestAgentBot, getNativeAccountsFromEnv } from "../../test-utils/test-actors";
import { COSTON_RUN_CONFIG_CONTRACTS } from "../../test-utils/test-bot-config";
import { requiredEventArgs } from "../../../src/utils/events/truffle";

const RPC_URL: string = requireEnv('RPC_URL');

describe("Agent bot tests - coston", async () => {
    let accounts: string[];
    let botConfig: AgentBotConfig;
    let context: IAssetAgentBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let challengerAddress: string;
    let runner: ScopedRunner;
    let state: TrackedState;
    let runConfig: AgentBotRunConfig;

    before(async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_CONTRACTS).toString()) as AgentBotRunConfig;
        accounts = await initWeb3(RPC_URL, getNativeAccountsFromEnv(), null);
        ownerAddress = accounts[0];
        challengerAddress = accounts[3];
        botConfig = await createAgentBotConfig(runConfig);
        orm = botConfig.orm;
        context = await createAssetContext(botConfig, botConfig.chains[0]);
    });

    beforeEach(async () => {
        runner = new ScopedRunner();
        const lastBlock = await web3.eth.getBlockNumber();
        state = new TrackedState(context, lastBlock);
        await state.initialize();
    });

    it("Should create agent bot", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        expect(agentBot.agent.underlyingAddress).is.not.null;
        expect(agentBot.agent.ownerAddress).to.eq(ownerAddress);
        // read from entity
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        const agentBotFromEnt = await AgentBot.fromEntity(context, agentEnt, new Notifier())
        expect(agentBotFromEnt.agent.underlyingAddress).is.not.null;
        expect(agentBotFromEnt.agent.ownerAddress).to.eq(ownerAddress);
        // sort of clean up
        await agentBot.agent.announceDestroy();
    });

    it("Should create agent bot runner", async () => {
        const contexts: Map<number, IAssetAgentBotContext> = new Map();
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

    it("Should create challenger", async () => {
        const challenger = new Challenger(runner, challengerAddress, state, await context.blockchainIndexer.getBlockHeight());
        expect(challenger.address).to.eq(challengerAddress);
    });

    it.skip("Clean agents if allowed", async () => {
        const list = await context.assetManager.getAllAgents(0, 20);
        for (const agentAddress of list[0]) {
            try {
                const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentAddress, active: true } as FilterQuery<AgentEntity>);
                const res = await context.assetManager.destroyAgent(agentAddress, ownerAddress, { from: ownerAddress });
                const eventArgs = requiredEventArgs(res, 'AgentDestroyed');
                if (eventArgs) {
                    agentEnt.active = false;
                    await orm.em.persistAndFlush(agentEnt);
                }
            } catch (e) {
                if (e instanceof Error) {
                    console.log(e.message);
                    if (e.message.includes('destroy not announced')) {
                        await context.assetManager.announceDestroyAgent(agentAddress, { from: ownerAddress });
                    }
                }
            }
        }
    });

});