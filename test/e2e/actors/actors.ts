import { FilterQuery } from "@mikro-orm/core/typings";
import { expect } from "chai";
import { readFileSync } from "fs";
import { AgentBot } from "../../../src/actors/AgentBot";
import { AgentBotRunner } from "../../../src/actors/AgentBotRunner";
import { AgentBotConfig, AgentBotRunConfig, TrackedStateConfig, TrackedStateRunConfig, createAgentBotConfig, createAgentBotDefaultSettings, createTrackedStateConfig } from "../../../src/config/BotConfig";
import { createAssetContext, createTrackedStateAssetContext } from "../../../src/config/create-asset-context";
import { ORM } from "../../../src/config/orm";
import { AgentEntity } from "../../../src/entities/agent";
import { AgentBotDefaultSettings, IAssetAgentBotContext, IAssetTrackedStateContext } from "../../../src/fasset-bots/IAssetBotContext";
import { toBN, toBNExp } from "../../../src/utils/helpers";
import { Notifier } from "../../../src/utils/Notifier";
import { initWeb3, web3 } from "../../../src/utils/web3";
import { createTestAgentBot, createTestChallenger, createTestLiquidator, createTestSystemKeeper } from "../../test-utils/test-actors/test-actors";
import { COSTON_RUN_CONFIG_CONTRACTS, COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS } from "../../test-utils/test-bot-config";
import { balanceOfClass1, cleanUp, depositClass1Amount, getNativeAccountsFromEnv } from "../../test-utils/test-helpers";
import { TrackedState } from "../../../src/state/TrackedState";
import { DBWalletKeys } from "../../../src/underlying-chain/WalletKeys";
import { ActorBase, ActorBaseKind } from "../../../src/fasset-bots/ActorBase";
import { ActorBaseRunner } from "../../../src/actors/ActorBaseRunner";
import { SystemKeeper } from "../../../src/actors/SystemKeeper";
import { Liquidator } from "../../../src/actors/Liquidator";
import { Challenger } from "../../../src/actors/Challenger";

const buyPoolTokens = toBNExp(500, 18);

describe("Actor tests - coston", async () => {
    let accounts: string[];
    // for agent
    let botConfig: AgentBotConfig;
    let runConfig: AgentBotRunConfig;
    let context: IAssetAgentBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let class1TokenAddress: string;
    // for challenger, liquidator, systemKeeper
    let trackedStateConfig: TrackedStateConfig;
    let trackedStateContext: IAssetTrackedStateContext;
    let state: TrackedState;
    let runSimplifiedConfig: TrackedStateRunConfig;
    let challengerAddress: string;
    let liquidatorAddress: string;
    let systemKeeperAddress: string;

    before(async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_CONTRACTS).toString()) as AgentBotRunConfig;
        runSimplifiedConfig = JSON.parse(readFileSync(COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS).toString()) as TrackedStateRunConfig;
        // accounts
        accounts = await initWeb3(runConfig.rpcUrl, getNativeAccountsFromEnv(), null);
        ownerAddress = accounts[0];
        challengerAddress = accounts[1]
        liquidatorAddress = accounts[2]
        systemKeeperAddress = accounts[3]
        // configs
        botConfig = await createAgentBotConfig(runConfig);
        orm = botConfig.orm;
        trackedStateConfig = await createTrackedStateConfig(runSimplifiedConfig);
        // contexts
        context = await createAssetContext(botConfig, botConfig.chains[0]);
        trackedStateContext = await createTrackedStateAssetContext(trackedStateConfig, trackedStateConfig.chains[0]);
        // agent default settings
        const agentBotSettings: AgentBotDefaultSettings = await createAgentBotDefaultSettings(context, runConfig.defaultAgentSettingsPath);
        class1TokenAddress = agentBotSettings.class1CollateralToken;
        // tracked state
        const lastBlock = await web3.eth.getBlockNumber();
        state = new TrackedState(trackedStateContext, lastBlock);
        await state.initialize();
        // mint class1 to owner
        // await mintClass1ToOwner(class1TokenAddress, ownerAddress);
    });

    after(async () => {
        await cleanUp(context, orm, ownerAddress);
    });

    it("Should create agent bot, deposit class1, buy pool tokens and announce destroy", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, runConfig.defaultAgentSettingsPath);
        expect(agentBot.agent.underlyingAddress).is.not.null;
        expect(agentBot.agent.ownerAddress).to.eq(ownerAddress);
        // read from entity
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        const agentBotFromEnt = await AgentBot.fromEntity(context, agentEnt, new Notifier())
        expect(agentBotFromEnt.agent.underlyingAddress).is.not.null;
        expect(agentBotFromEnt.agent.ownerAddress).to.eq(ownerAddress);
        // deposit class 1
        const depositAmount = depositClass1Amount.divn(3);
        await agentBot.agent.depositClass1Collateral(depositAmount);
        const agentClass1Balance = await balanceOfClass1(class1TokenAddress, agentBot.agent.vaultAddress);
        expect(agentClass1Balance.eq(depositAmount)).to.be.true;
        // buy collateral pool tokens
        await agentBot.agent.buyCollateralPoolTokens(buyPoolTokens);
        const agentInfo = await context.assetManager.getAgentInfo(agentBot.agent.vaultAddress);
        expect(toBN(agentInfo.totalPoolCollateralNATWei).eq(buyPoolTokens));
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
        const challenger = await createTestChallenger(challengerAddress, state, trackedStateContext);
        expect(challenger.address).to.eq(challengerAddress);
        const blockHeight = await context.blockchainIndexer.getBlockHeight();
        expect(challenger.lastEventUnderlyingBlockHandled).to.be.lte(blockHeight);
    });

    it("Should create liquidator", async () => {
        const liquidator = await createTestLiquidator(liquidatorAddress, state);
        expect(liquidator.address).to.eq(liquidatorAddress);
    });

    it("Should create systemKeeper", async () => {
        const systemKeeper = await createTestSystemKeeper(systemKeeperAddress, state);
        expect(systemKeeper.address).to.eq(systemKeeperAddress);
    });

    it("Should create actor bot runner from  config", async () => {
        const actorBaseRunner1 = await ActorBaseRunner.create(trackedStateConfig, challengerAddress, ActorBaseKind.CHALLENGER);
        expect(actorBaseRunner1.loopDelay).to.eq(trackedStateConfig.loopDelay);
        expect(actorBaseRunner1.actor.address).to.eq(challengerAddress);
        expect(actorBaseRunner1.actor instanceof Challenger).to.be.true;


        const actorBaseRunner2 = await ActorBaseRunner.create(trackedStateConfig, liquidatorAddress, ActorBaseKind.LIQUIDATOR);
        expect(actorBaseRunner2.loopDelay).to.eq(trackedStateConfig.loopDelay);
        expect(actorBaseRunner2.actor.address).to.eq(liquidatorAddress);
        expect(actorBaseRunner2.actor instanceof Liquidator).to.be.true;

        const actorBaseRunner3 = await ActorBaseRunner.create(trackedStateConfig, systemKeeperAddress, ActorBaseKind.SYSTEM_KEEPER);
        expect(actorBaseRunner3.loopDelay).to.eq(trackedStateConfig.loopDelay);
        expect(actorBaseRunner3.actor.address).to.eq(systemKeeperAddress);
        expect(actorBaseRunner3.actor instanceof SystemKeeper).to.be.true;
    });

});