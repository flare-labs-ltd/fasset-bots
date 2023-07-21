import { expect } from "chai";
import { createAgentBotDefaultSettings } from "../../../src/config/BotConfig";
import { ORM } from "../../../src/config/orm";
import { AgentBotDefaultSettings, IAssetAgentBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { sleep, toBN, toBNExp } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
import { BotCliCommands } from "../../../src/cli/BotCliCommands";
import { AGENT_DEFAULT_CONFIG_PATH, COSTON_RPC } from "../../test-utils/test-bot-config";
import { getNativeAccountsFromEnv } from "../../test-utils/test-helpers";
import { createTestAgentBotAndDepositCollaterals, createTestMinter, createTestRedeemer } from "../../test-utils/test-actors/test-actors";
import { AgentBot } from "../../../src/actors/AgentBot";
import { AgentEntity, AgentMintingState, AgentRedemptionState } from "../../../src/entities/agent";
import { FilterQuery } from "@mikro-orm/core";
import { Notifier } from "../../../src/utils/Notifier";
import { proveAndUpdateUnderlyingBlock } from "../../../src/utils/fasset-helpers";
import { Redeemer } from "../../../src/mock/Redeemer";
import { Minter } from "../../../src/mock/Minter";
import { DBWalletKeys } from "../../../src/underlying-chain/WalletKeys";
import { web3DeepNormalize } from "../../../src/utils/web3normalize";

const depositVaultCollateralAmount = toBNExp(300_000, 18);
const buyPoolTokens = toBNExp(700, 18);
const underlyingMinterAddress = "rw2M8AFty9wd5A66Jz4M1bmFaeDKrB4Bc1";

const runConfigFile = "./test/e2e/simulations/run-config-simulation.json";

describe.skip("Agent bot simulation - coston", async () => {
    let accounts: string[];
    let botCliCommands: BotCliCommands;
    let context: IAssetAgentBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let vaultCollateralTokenAddress: string;
    let agentBot: AgentBot;
    let minter: Minter;
    let redeemer: Redeemer;

    before(async () => {
        // init bot cli commands
        botCliCommands = new BotCliCommands();
        await botCliCommands.initEnvironment(runConfigFile);
        // init web3 and get addresses
        accounts = await initWeb3(COSTON_RPC, getNativeAccountsFromEnv(), null);
        ownerAddress = accounts[0];
        minterAddress = accounts[2];
        // set orm
        orm = botCliCommands.botConfig.orm;
        // set context
        context = botCliCommands.context;


        // agent bot
        // check if agent already exists
        const agentEnt = await orm.em.findOne(AgentEntity, { ownerAddress: ownerAddress } as FilterQuery<AgentEntity>);
        if (agentEnt) {
            agentBot = await AgentBot.fromEntity(context, agentEnt, new Notifier());
        } else {
            const agentBotSettings: AgentBotDefaultSettings = await createAgentBotDefaultSettings(context, AGENT_DEFAULT_CONFIG_PATH);
            vaultCollateralTokenAddress = agentBotSettings.vaultCollateralToken;
            agentBot = await createTestAgentBotAndDepositCollaterals(context, orm, ownerAddress, AGENT_DEFAULT_CONFIG_PATH, depositVaultCollateralAmount, buyPoolTokens);
            // make available
            await agentBot.agent.makeAvailable();
        }

        // await mintVaultCollateralToOwner(vaultCollateralTokenAddress, ownerAddress);
        // await whitelistAgent(accounts, ownerAddress, "0x392Def29bb0cd8ca844f84240422d20032db3023")

        // minter
        minter = await createTestMinter(context, minterAddress, underlyingMinterAddress);

        // redeemer
        redeemer = await createTestRedeemer(context, minterAddress, underlyingMinterAddress);

    });

    it("Should simulate minting and redeeming", async () => {
        await agentBot.runStep(orm.em)
        const lots = 1;
        // update underlying block manually
        await proveAndUpdateUnderlyingBlock(context, ownerAddress);
        // reserve collateral
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, lots);
        // pay
        await minter.performMintingPayment(crt);
        // wait for minting to be executed
        for (let i = 0; ; i++) {
            await agentBot.runStep(orm.em);
            // check if minting is done
            orm.em.clear();
            const minting = await agentBot.findMinting(orm.em, crt.collateralReservationId);
            console.log(`Agent step ${i}, minting state = ${minting.state}`);
            if (minting.state === AgentMintingState.DONE) break;
            await sleep(20000);
        }
        await agentBot.runStep(orm.em)
        // update underlying block manually
        await proveAndUpdateUnderlyingBlock(context, ownerAddress);
        // request redemption
        const [rdReqs] = await redeemer.requestRedemption(lots);
        const rdReq = rdReqs[0];
        // wait for redemption to be executed
        for (let i = 0; ; i++) {
            await agentBot.runStep(orm.em);
            // check if minting is done
            orm.em.clear();
            const redemption = await agentBot.findRedemption(orm.em, rdReq.requestId);
            console.log(`Agent step ${i}, redemption state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.DONE) break;
            await sleep(20000);
        }
        await agentBot.runStep(orm.em)

    });

});
