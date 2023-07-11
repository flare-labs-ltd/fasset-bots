import { expect } from "chai";
import { createAgentBotDefaultSettings } from "../../../src/config/BotConfig";
import { ORM } from "../../../src/config/orm";
import { AgentBotDefaultSettings, IAssetAgentBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { TrackedState } from "../../../src/state/TrackedState";
import { ScopedRunner } from "../../../src/utils/events/ScopedRunner";
import { MINUTES, requireEnv, sleep, toBN, toBNExp } from "../../../src/utils/helpers";
import { initWeb3, web3 } from "../../../src/utils/web3";
import { balanceOfClass1, cleanUp, createTestAgentBot, depositClass1Amount, getNativeAccountsFromEnv, mintClass1ToOwner } from "../../test-utils/test-actors";
import { BotCliCommands } from "../../../src/cli/BotCliCommands";
import { AgentEntity } from "../../../src/entities/agent";
import { FilterQuery } from "@mikro-orm/core";

const RPC_URL: string = requireEnv('RPC_URL');
const buyPoolTokens = toBNExp(2500, 18);
const minuteInSeconds = MINUTES * 1000;

describe("Agent bot tests - coston", async () => {
    let accounts: string[];
    let botCliCommands: BotCliCommands;
    let context: IAssetAgentBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let challengerAddress: string;
    let runner: ScopedRunner;
    let state: TrackedState;
    let class1TokenAddress: string;

    before(async () => {
        botCliCommands = new BotCliCommands();
        await botCliCommands.initEnvironment();
        accounts = await initWeb3(RPC_URL, getNativeAccountsFromEnv(), null);
        ownerAddress = accounts[0];
        challengerAddress = accounts[3];
        orm = botCliCommands.botConfig.orm;
        context = botCliCommands.context;
        const agentBotSettings: AgentBotDefaultSettings = await createAgentBotDefaultSettings(context);
        class1TokenAddress = agentBotSettings.class1CollateralToken;
        // await mintClass1ToOwner(class1TokenAddress, ownerAddress);
    });

    beforeEach(async () => {
        runner = new ScopedRunner();
        const lastBlock = await web3.eth.getBlockNumber();
        state = new TrackedState(context, lastBlock);
        await state.initialize();
    });

    after(async () => {
        // await cleanUp(context, orm, ownerAddress);
    });

    it("Should create agent bot, deposit class1, buy collateral pool tokens, make available, exit available, destroy", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const vaultAddress = agentBot.agent.vaultAddress;
        expect(agentBot.agent.underlyingAddress).is.not.null;
        expect(agentBot.agent.ownerAddress).to.eq(ownerAddress);
        // deposit class 1
        const depositAmount = depositClass1Amount.divn(3);
        await botCliCommands.depositToVault(vaultAddress, depositAmount.toString());
        const agentClass1Balance = await balanceOfClass1(class1TokenAddress, agentBot.agent.vaultAddress);
        expect(agentClass1Balance.eq(depositAmount)).to.be.true;
        // buy collateral pool tokens
        await botCliCommands.buyCollateralPoolTokens(vaultAddress, buyPoolTokens.toString());
        const agentInfo = await context.assetManager.getAgentInfo(agentBot.agent.vaultAddress);
        console.log("freeCollateralLots", agentInfo.freeCollateralLots.toString());
        console.log("totalAgentPoolTokensWei", agentInfo.totalAgentPoolTokensWei.toString())
        console.log("totalClass1CollateralWei", agentInfo.totalClass1CollateralWei.toString())
        console.log("totalPoolCollateralNATWei", agentInfo.totalPoolCollateralNATWei.toString())
        expect(toBN(agentInfo.totalPoolCollateralNATWei).eq(buyPoolTokens));

        const agentCollateral = await agentBot.agent.getAgentCollateral();
        console.log("freeCollateralLots", agentCollateral.freeCollateralLots().toString());
/*        // make available
        await botCliCommands.enterAvailableList(vaultAddress);
        // sort of clean up
 */       await botCliCommands.closeVault(vaultAddress);
        for (let i = 0; ; i++) {
            await sleep(minuteInSeconds);
            await agentBot.runStep(orm.em);
            // check if redemption is done
            orm.em.clear();
            const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress } as FilterQuery<AgentEntity>);
            console.log(`Agent step ${i}, state = ${agentEnt.active}`);
            if (agentEnt.active === false) break;
        }

    });


});