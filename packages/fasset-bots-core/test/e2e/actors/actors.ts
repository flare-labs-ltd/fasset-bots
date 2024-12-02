import { FilterQuery } from "@mikro-orm/core";
import { expect, spy, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import spies from "chai-spies";
import { ChainId, TimeKeeper } from "../../../src";
import { ActorBaseRunner } from "../../../src/actors/ActorBaseRunner";
import { AgentBot } from "../../../src/actors/AgentBot";
import { AgentBotRunner } from "../../../src/actors/AgentBotRunner";
import { Challenger } from "../../../src/actors/Challenger";
import { Liquidator } from "../../../src/actors/Liquidator";
import { SystemKeeper } from "../../../src/actors/SystemKeeper";
import { TimeKeeperService } from "../../../src/actors/TimeKeeperService";
import { AgentBotConfig, AgentBotSettings, BotFAssetAgentConfig, BotFAssetConfigWithIndexer, KeeperBotConfig, Secrets } from "../../../src/config";
import { AgentVaultInitSettings, createAgentVaultInitSettings, loadAgentSettings } from "../../../src/config/AgentVaultInitSettings";
import { createBotConfig } from "../../../src/config/BotConfig";
import { loadConfigFile } from "../../../src/config/config-file-loader";
import { BotConfigFile } from "../../../src/config/config-files/BotConfigFile";
import { createAgentBotContext, createChallengerContext, createNativeContext } from "../../../src/config/create-asset-context";
import { ORM } from "../../../src/config/orm";
import { AgentEntity } from "../../../src/entities/agent";
import { ActorBaseKind } from "../../../src/fasset-bots/ActorBase";
import { IAssetAgentContext } from "../../../src/fasset-bots/IAssetBotContext";
import { Agent, OwnerAddressPair } from "../../../src/fasset/Agent";
import { TrackedState } from "../../../src/state/TrackedState";
import { requireNotNull, sleep } from "../../../src/utils";
import { authenticatedHttpProvider, initWeb3, web3 } from "../../../src/utils/web3";
import { testTimekeeperTimingConfig } from "../../../test-hardhat/test-utils/create-test-asset-context";
import { testTimekeeperService } from "../../../test-hardhat/test-utils/helpers";
import { createTestAgentBot, createTestChallenger, createTestLiquidator, createTestSystemKeeper } from "../../test-utils/test-actors/test-actors";
import { COSTON_RUN_CONFIG_CONTRACTS, COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS, COSTON_TEST_AGENT_SETTINGS, TEST_SECRETS } from "../../test-utils/test-bot-config";
import { cleanUp, enableSlowTests, getNativeAccounts, itIf } from "../../test-utils/test-helpers";
import { testNotifierTransports } from "../../test-utils/testNotifierTransports";
use(chaiAsPromised);
use(spies);

const fAssetSymbol = "FTestXRP";

describe("Actor tests - coston", () => {
    let accounts: string[];
    // for agent
    let secrets: Secrets;
    let botConfig: AgentBotConfig;
    let runConfig: BotConfigFile;
    let context: IAssetAgentContext;
    let orm: ORM;
    let ownerManagementAddress: string;
    let ownerAddress: string;
    let ownerUnderlyingAddress: string;
    // for challenger, liquidator, systemKeeper
    let actorConfig: KeeperBotConfig;
    let state: TrackedState;
    let runSimplifiedConfig: BotConfigFile;
    let challengerAddress: string;
    let liquidatorAddress: string;
    let systemKeeperAddress: string;
    let chainConfigAgent: BotFAssetAgentConfig;
    let chainConfigActor: BotFAssetConfigWithIndexer;
    // newly create agents that are destroyed after these tests
    const destroyAgentsAfterTests: string[] = [];

    before(async () => {
        secrets = await Secrets.load(TEST_SECRETS);
        runConfig = loadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        runSimplifiedConfig = loadConfigFile(COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS);
        // accounts
        accounts = await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, secrets.optional("apiKey.native_rpc")), getNativeAccounts(secrets), null);
        ownerManagementAddress = secrets.required("owner.management.address");
        ownerAddress = secrets.required("owner.native.address");
        ownerUnderlyingAddress = AgentBot.underlyingAddress(secrets, ChainId.from(runConfig.fAssets[fAssetSymbol].chainId));
        challengerAddress = accounts[1];
        liquidatorAddress = accounts[2];
        systemKeeperAddress = accounts[3];
        // configs
        botConfig = await createBotConfig("agent", secrets, runConfig, ownerAddress);
        orm = botConfig.orm!;
        actorConfig = await createBotConfig("keeper", secrets, runSimplifiedConfig, ownerAddress);
        // contexts
        chainConfigAgent = requireNotNull(botConfig.fAssets.get(fAssetSymbol));
        context = await createAgentBotContext(botConfig, chainConfigAgent!);
        chainConfigActor = requireNotNull(actorConfig.fAssets.get(fAssetSymbol));
        // tracked state
        const lastBlock = await web3.eth.getBlockNumber();
        const trackedStateContext = await createNativeContext(actorConfig, chainConfigActor!);
        state = new TrackedState(trackedStateContext, lastBlock);
        await state.initialize();
    });

    after(async () => {
        await cleanUp(context, chainConfigAgent.agentBotSettings, orm, ownerAddress, ownerUnderlyingAddress, destroyAgentsAfterTests);
    });

    itIf(enableSlowTests())("Should create agent bot and announce destroy", async () => {
        const agentBot = await createTestAgentBot(context, chainConfigAgent.agentBotSettings, orm, ownerAddress, ownerUnderlyingAddress, COSTON_TEST_AGENT_SETTINGS);
        expect(agentBot.agent.underlyingAddress).is.not.null;
        expect(agentBot.agent.owner.managementAddress).to.eq(ownerAddress);
        // read from entity
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        const agentBotFromEnt = await AgentBot.fromEntity(context, chainConfigAgent.agentBotSettings, agentEnt, ownerUnderlyingAddress, testNotifierTransports);
        expect(agentBotFromEnt.agent.underlyingAddress).is.not.null;
        expect(agentBotFromEnt.agent.owner.managementAddress).to.eq(ownerAddress);
        // sort of clean up
        await agentBot.agent.announceDestroy();
        destroyAgentsAfterTests.push(agentBot.agent.vaultAddress);
    });

    it("Should create agent bot runner", async () => {
        const contexts: Map<string, IAssetAgentContext> = new Map();
        contexts.set(context.chainInfo.symbol, context);
        const settings: Map<string, AgentBotSettings> = new Map();
        settings.set(context.chainInfo.symbol, chainConfigAgent.agentBotSettings);
        const agentBotRunner = new AgentBotRunner(secrets, contexts, settings, orm, 5, testNotifierTransports, testTimekeeperService, false, null);
        expect(agentBotRunner.loopDelay).to.eq(5);
        expect(agentBotRunner.contexts.get(context.chainInfo.symbol)).to.not.be.null;
    });

    it("Should create agent bot runner from bot config", async () => {
        const agentBotRunner = await AgentBotRunner.create(secrets, botConfig, testTimekeeperService);
        expect(agentBotRunner.loopDelay).to.eq(runConfig.loopDelay);
        expect(agentBotRunner.contexts.get(context.chainInfo.symbol)).to.not.be.null;
    });

    it("Should create challenger", async () => {
        const challengerContext = await createChallengerContext(actorConfig, chainConfigActor);
        const challenger = await createTestChallenger(challengerContext, challengerAddress, state);
        expect(challenger.address).to.eq(challengerAddress);
        const blockHeight = await context.blockchainIndexer.getBlockHeight();
        const finalizationBlocks = 6;
        expect(challenger.lastEventUnderlyingBlockHandled).to.be.lte(blockHeight + finalizationBlocks);
    });

    it("Should create liquidator", async () => {
        const liquidatorContext = await createChallengerContext(actorConfig, chainConfigActor);
        const liquidator = await createTestLiquidator(liquidatorContext, liquidatorAddress, state);
        expect(liquidator.address).to.eq(liquidatorAddress);
    });

    it("Should create systemKeeper", async () => {
        const systemKeeper = await createTestSystemKeeper(systemKeeperAddress, state);
        expect(systemKeeper.address).to.eq(systemKeeperAddress);
    });

    it("Should create actor bot runner from config", async () => {
        const fassetList = Array.from(actorConfig.fAssets.values());
        const actorBaseRunner1 = await ActorBaseRunner.create(actorConfig, challengerAddress, ActorBaseKind.CHALLENGER, fassetList[0]);
        expect(actorBaseRunner1.loopDelay).to.eq(actorConfig.loopDelay);
        expect(actorBaseRunner1.actor.address).to.eq(challengerAddress);
        expect(actorBaseRunner1.actor instanceof Challenger).to.be.true;

        const actorBaseRunner2 = await ActorBaseRunner.create(actorConfig, liquidatorAddress, ActorBaseKind.LIQUIDATOR, fassetList[0]);
        expect(actorBaseRunner2.loopDelay).to.eq(actorConfig.loopDelay);
        expect(actorBaseRunner2.actor.address).to.eq(liquidatorAddress);
        expect(actorBaseRunner2.actor instanceof Liquidator).to.be.true;

        const actorBaseRunner3 = await ActorBaseRunner.create(actorConfig, systemKeeperAddress, ActorBaseKind.SYSTEM_KEEPER, fassetList[1]);
        expect(actorBaseRunner3.loopDelay).to.eq(actorConfig.loopDelay);
        expect(actorBaseRunner3.actor.address).to.eq(systemKeeperAddress);
        expect(actorBaseRunner3.actor instanceof SystemKeeper).to.be.true;
    });

    it("should start and stop timekeepers", async () => {
        const spyUpdate = spy.on(TimeKeeper.prototype, "updateUnderlyingBlock");
        try {
            const timekeeperService = await TimeKeeperService.create(actorConfig, ownerAddress, testTimekeeperTimingConfig({ queryWindow: 7200, updateIntervalMs: 300_000 }))
            timekeeperService.startAll();
            const timekeepers = Array.from(timekeeperService.timekeepers.values());
            expect(timekeepers.length).to.be.eq(2);
            await sleep(2000);
            await timekeeperService.stopAll();
            expect(spyUpdate).to.be.called.exactly(2);
        } finally {
            spy.restore(TimeKeeper.prototype);
        }
    });

    itIf(enableSlowTests())("Should not create agent - unknown address", async () => {
        const agentBotSettings: AgentVaultInitSettings = await createAgentVaultInitSettings(context, loadAgentSettings(COSTON_TEST_AGENT_SETTINGS));
        const underlyingAddress = "underlying";
        const addressValidityProof = await context.attestationProvider.proveAddressValidity(underlyingAddress);
        const owner = new OwnerAddressPair("ownerAddress", "ownerAddress");
        await expect(Agent.create(context, owner, addressValidityProof, agentBotSettings)).to.eventually.be.rejected.and.be.an.instanceOf(Error);
    });
});
