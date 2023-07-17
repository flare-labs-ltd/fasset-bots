import { expect } from "chai";
import { createAgentBotDefaultSettings } from "../../../src/config/BotConfig";
import { ORM } from "../../../src/config/orm";
import { AgentBotDefaultSettings, IAssetAgentBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { MINUTES, toBNExp } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
import { BotCliCommands } from "../../../src/cli/BotCliCommands";
import { AGENT_DEFAULT_CONFIG_PATH, COSTON_RPC } from "../../test-utils/test-bot-config";
import { getNativeAccountsFromEnv, mintClass1ToOwner } from "../../test-utils/test-helpers";
import { createTestAgentBotAndDepositCollaterals, createTestMinter } from "../../test-utils/test-actors/test-actors";

const depositClass1Amount = toBNExp(300_000, 18);
const buyPoolTokens = toBNExp(500, 18);
const minuteInSeconds = MINUTES * 1000;
const agentVaultAddress = "0xBd1266020CaA3428599a247076bF84a7b20Fde0A";
const underlyingMinterAddress = "rw2M8AFty9wd5A66Jz4M1bmFaeDKrB4Bc1";

describe("Agent bot simulation - coston", async () => {
    let accounts: string[];
    let botCliCommands: BotCliCommands;
    let context: IAssetAgentBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let class1TokenAddress: string;

    before(async () => {
        botCliCommands = new BotCliCommands();
        await botCliCommands.initEnvironment();
        accounts = await initWeb3(COSTON_RPC, getNativeAccountsFromEnv(), null);
        ownerAddress = accounts[0];
        minterAddress = accounts[2];
        orm = botCliCommands.botConfig.orm;
        context = botCliCommands.context;
        const agentBotSettings: AgentBotDefaultSettings = await createAgentBotDefaultSettings(context, AGENT_DEFAULT_CONFIG_PATH);
        class1TokenAddress = agentBotSettings.class1CollateralToken;
        await mintClass1ToOwner(class1TokenAddress, ownerAddress);
        // await whitelistAgent(accounts, ownerAddress, "0x392Def29bb0cd8ca844f84240422d20032db3023")
        // add minter underlying address to DBwallet
    });

    it.skip("Payment test",async () => {
        const minter = await createTestMinter(context, minterAddress, underlyingMinterAddress);
        expect(minter.address).to.eq(minterAddress);
        expect(minter.underlyingAddress).to.eq(underlyingMinterAddress);
        await minter.performPayment("rsDW4NSnwBsJNaCediN96WM2PRZ5xNUgdy", 10000000, "0x1111111111110001000000000000000000000000000000000000000000000001");
    });

    it.skip("Should create collateral reservation", async () => {
        // get agent
        const agentBot = await createTestAgentBotAndDepositCollaterals(context, orm, ownerAddress, AGENT_DEFAULT_CONFIG_PATH, depositClass1Amount, buyPoolTokens);
        // make available
        await agentBot.agent.makeAvailable();
        // create minter
        const minter = await createTestMinter(context, minterAddress, underlyingMinterAddress);
        // reserve collateral
        const lots = 1;
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, lots);
        // pay
        const txHash = await minter.performMintingPayment(crt);
        console.log(txHash);
        await agentBot.runStep(orm.em);
    });

});