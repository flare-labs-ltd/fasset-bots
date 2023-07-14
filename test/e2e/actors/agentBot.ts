import { FilterQuery } from "@mikro-orm/core/typings";
import { expect } from "chai";
import { readFileSync } from "fs";
import { AgentBot } from "../../../src/actors/AgentBot";
import { AgentBotRunner } from "../../../src/actors/AgentBotRunner";
import { AgentBotConfig, AgentBotRunConfig, createAgentBotConfig, createAgentBotDefaultSettings } from "../../../src/config/BotConfig";
import { createAssetContext } from "../../../src/config/create-asset-context";
import { ORM } from "../../../src/config/orm";
import { AgentEntity } from "../../../src/entities/agent";
import { AgentBotDefaultSettings, IAssetAgentBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { toBN, toBNExp } from "../../../src/utils/helpers";
import { Notifier } from "../../../src/utils/Notifier";
import { initWeb3 } from "../../../src/utils/web3";
import { createTestAgentBot } from "../../test-utils/test-actors/test-actors";
import { COSTON_RUN_CONFIG_CONTRACTS } from "../../test-utils/test-bot-config";
import { balanceOfClass1, cleanUp, depositClass1Amount, getNativeAccountsFromEnv, mintClass1ToOwner } from "../../test-utils/test-helpers";

const buyPoolTokens = toBNExp(1600, 18);

describe("Agent bot tests - coston", async () => {
    let accounts: string[];
    let botConfig: AgentBotConfig;
    let context: IAssetAgentBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let runConfig: AgentBotRunConfig;
    let class1TokenAddress: string;

    before(async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_CONTRACTS).toString()) as AgentBotRunConfig;
        accounts = await initWeb3(runConfig.rpcUrl, getNativeAccountsFromEnv(), null);
        ownerAddress = accounts[0];
        botConfig = await createAgentBotConfig(runConfig);
        orm = botConfig.orm;
        context = await createAssetContext(botConfig, botConfig.chains[0]);
        const agentBotSettings: AgentBotDefaultSettings = await createAgentBotDefaultSettings(context, runConfig.defaultAgentSettingsPath);
        class1TokenAddress = agentBotSettings.class1CollateralToken;
        await mintClass1ToOwner(class1TokenAddress, ownerAddress);
    });

    after(async () => {
        // await cleanUp(context, orm, ownerAddress);
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

});