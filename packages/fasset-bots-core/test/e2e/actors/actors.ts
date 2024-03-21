import { FilterQuery } from "@mikro-orm/core";
import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ActorBaseRunner } from "../../../src/actors/ActorBaseRunner";
import { AgentBot } from "../../../src/actors/AgentBot";
import { AgentBotRunner } from "../../../src/actors/AgentBotRunner";
import { Challenger } from "../../../src/actors/Challenger";
import { Liquidator } from "../../../src/actors/Liquidator";
import { SystemKeeper } from "../../../src/actors/SystemKeeper";
import { BotConfig, createAgentBotDefaultSettings, createBotConfig, loadAgentSettings, loadConfigFile } from "../../../src/config/BotConfig";
import { BotConfigFile } from "../../../src/config/config-files";
import { createActorAssetContext, createAssetContext } from "../../../src/config/create-asset-context";
import { ORM } from "../../../src/config/orm";
import { getSecrets, requireSecret } from "../../../src/config/secrets";
import { AgentEntity } from "../../../src/entities/agent";
import { ActorBaseKind } from "../../../src/fasset-bots/ActorBase";
import { AgentBotDefaultSettings, IAssetActorContext, IAssetAgentBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { Agent, OwnerAddressPair } from "../../../src/fasset/Agent";
import { TrackedState } from "../../../src/state/TrackedState";
import { authenticatedHttpProvider, initWeb3, web3 } from "../../../src/utils/web3";
import { createTestAgentBot, createTestChallenger, createTestLiquidator, createTestSystemKeeper } from "../../test-utils/test-actors/test-actors";
import { COSTON_RUN_CONFIG_CONTRACTS, COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS, COSTON_TEST_AGENT_SETTINGS } from "../../test-utils/test-bot-config";
import { cleanUp, getNativeAccountsFromEnv } from "../../test-utils/test-helpers";
import { testNotifierTransports } from "../../test-utils/testNotifierTransports";
use(chaiAsPromised);

const fAssetSymbol = "FtestXRP";

describe("Actor tests - coston", async () => {
    let accounts: string[];
    // for agent
    let botConfig: BotConfig;
    let runConfig: BotConfigFile;
    let context: IAssetAgentBotContext;
    let orm: ORM;
    let ownerManagementAddress: string;
    let ownerAddress: string;
    // for challenger, liquidator, systemKeeper
    let actorConfig: BotConfig;
    let actorContext: IAssetActorContext;
    let state: TrackedState;
    let runSimplifiedConfig: BotConfigFile;
    let challengerAddress: string;
    let liquidatorAddress: string;
    let systemKeeperAddress: string;
    // newly create agents that are destroyed after these tests
    const destroyAgentsAfterTests: string[] = [];

    before(async () => {
        runConfig = loadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        runSimplifiedConfig = loadConfigFile(COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS);
        // accounts
        accounts = await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), getNativeAccountsFromEnv(), null);
        ownerManagementAddress = requireSecret("owner.management.address");
        ownerAddress = requireSecret("owner.native.address");
        challengerAddress = accounts[1];
        liquidatorAddress = accounts[2];
        systemKeeperAddress = accounts[3];
        // configs
        botConfig = await createBotConfig(runConfig, ownerAddress);
        orm = botConfig.orm!;
        actorConfig = await createBotConfig(runSimplifiedConfig, ownerAddress);
        // contexts
        const chainConfig1 = botConfig.fAssets.find((cc) => cc.fAssetSymbol === fAssetSymbol);
        context = await createAssetContext(botConfig, chainConfig1!);
        const chainConfig2 = actorConfig.fAssets.find((cc) => cc.fAssetSymbol === fAssetSymbol);
        actorContext = await createActorAssetContext(actorConfig, chainConfig2!, ActorBaseKind.CHALLENGER);
        // tracked state
        const lastBlock = await web3.eth.getBlockNumber();
        state = new TrackedState(actorContext, lastBlock);
        await state.initialize();
    });

    after(async () => {
        await cleanUp(context, orm, ownerAddress, destroyAgentsAfterTests);
    });

    it("Should create agent bot and announce destroy", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, COSTON_TEST_AGENT_SETTINGS);
        expect(agentBot.agent.underlyingAddress).is.not.null;
        expect(agentBot.agent.owner.managementAddress).to.eq(ownerAddress);
        // read from entity
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        const agentBotFromEnt = await AgentBot.fromEntity(context, agentEnt, testNotifierTransports);
        expect(agentBotFromEnt.agent.underlyingAddress).is.not.null;
        expect(agentBotFromEnt.agent.owner.managementAddress).to.eq(ownerAddress);
        // sort of clean up
        await agentBot.agent.announceDestroy();
        destroyAgentsAfterTests.push(agentBot.agent.vaultAddress);
    });

    it("Should create agent bot runner", async () => {
        const contexts: Map<string, IAssetAgentBotContext> = new Map();
        contexts.set(context.chainInfo.symbol, context);
        const agentBotRunner = new AgentBotRunner(contexts, orm, ownerAddress, 5, testNotifierTransports);
        expect(agentBotRunner.loopDelay).to.eq(5);
        expect(agentBotRunner.contexts.get(context.chainInfo.symbol)).to.not.be.null;
    });

    it("Should create agent bot runner from bot config", async () => {
        const agentBotRunner = await AgentBotRunner.create(botConfig);
        expect(agentBotRunner.loopDelay).to.eq(runConfig.loopDelay);
        expect(agentBotRunner.contexts.get(context.chainInfo.symbol)).to.not.be.null;
    });

    it("Should not create agent bot runner - missing arguments", async () => {
        const config1 = Object.assign({}, botConfig);
        config1.orm = undefined;
        await expect(AgentBotRunner.create(config1))
            .to.eventually.be.rejectedWith(`Missing orm in config for owner ${ownerManagementAddress}.`)
            .and.be.an.instanceOf(Error);
    });

    it("Should create challenger", async () => {
        const challenger = await createTestChallenger(challengerAddress, state);
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

    it("Should create actor bot runner from config", async () => {
        const actorBaseRunner1 = await ActorBaseRunner.create(actorConfig, challengerAddress, ActorBaseKind.CHALLENGER, actorConfig.fAssets[0]);
        expect(actorBaseRunner1.loopDelay).to.eq(actorConfig.loopDelay);
        expect(actorBaseRunner1.actor.address).to.eq(challengerAddress);
        expect(actorBaseRunner1.actor instanceof Challenger).to.be.true;

        const actorBaseRunner2 = await ActorBaseRunner.create(actorConfig, liquidatorAddress, ActorBaseKind.LIQUIDATOR, actorConfig.fAssets[0]);
        expect(actorBaseRunner2.loopDelay).to.eq(actorConfig.loopDelay);
        expect(actorBaseRunner2.actor.address).to.eq(liquidatorAddress);
        expect(actorBaseRunner2.actor instanceof Liquidator).to.be.true;

        const actorBaseRunner3 = await ActorBaseRunner.create(actorConfig, systemKeeperAddress, ActorBaseKind.SYSTEM_KEEPER, actorConfig.fAssets[1]);
        expect(actorBaseRunner3.loopDelay).to.eq(actorConfig.loopDelay);
        expect(actorBaseRunner3.actor.address).to.eq(systemKeeperAddress);
        expect(actorBaseRunner3.actor instanceof SystemKeeper).to.be.true;
    });

    it("Should not create agent - unknown address", async () => {
        const agentBotSettings: AgentBotDefaultSettings = await createAgentBotDefaultSettings(context, loadAgentSettings(COSTON_TEST_AGENT_SETTINGS));
        const underlyingAddress = "underlying";
        const addressValidityProof = await context.attestationProvider.proveAddressValidity(underlyingAddress);
        const owner = new OwnerAddressPair("ownerAddress", "ownerAddress");
        await expect(Agent.create(context, owner, addressValidityProof, agentBotSettings)).to.eventually.be.rejected.and.be.an.instanceOf(Error);
    });
});
