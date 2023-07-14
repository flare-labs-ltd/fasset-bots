import { expect } from "chai";
import { createAgentBotDefaultSettings } from "../../../src/config/BotConfig";
import { ORM } from "../../../src/config/orm";
import { AgentBotDefaultSettings, IAssetAgentBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { MINUTES, toBNExp } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
import { BotCliCommands } from "../../../src/cli/BotCliCommands";
import { AGENT_DEFAULT_CONFIG_PATH, COSTON_RPC } from "../../test-utils/test-bot-config";
import { findAgentBotFromDB, getNativeAccountsFromEnv, mintClass1ToOwner } from "../../test-utils/test-helpers";
import { createTestMinter } from "../../test-utils/test-actors/test-actors";

const buyPoolTokens = toBNExp(2500, 18);
const minuteInSeconds = MINUTES * 1000;
const agentVaultAddress = "0xedaB59ee3d6CA92C3F188A42171D8467AcA993dc";
const underlyingMinter = "rDgEA1iU1B5tDBiNSbJHzjLsayv3EntHWm";

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
        minterAddress = accounts[1];
        orm = botCliCommands.botConfig.orm;
        context = botCliCommands.context;
        const agentBotSettings: AgentBotDefaultSettings = await createAgentBotDefaultSettings(context, AGENT_DEFAULT_CONFIG_PATH);
        class1TokenAddress = agentBotSettings.class1CollateralToken;
        await mintClass1ToOwner(class1TokenAddress, ownerAddress);
        // await whitelistAgent(accounts, ownerAddress, "0x392Def29bb0cd8ca844f84240422d20032db3023")
    });

    it("Payment test",async () => {
        console.log()
        const minter = await createTestMinter(context, minterAddress, underlyingMinter);
        console.log(minter.underlyingAddress);
        console.log((await context.wallet.getBalance(minter.underlyingAddress)).toString());
        const tx = await minter.performPayment("rBuLWiShR4qTYBs6AUUkcdzbqJyKV4f935", 3300000, "0x1111111111110001000000000000000000000000000000000000000000000115");
        console.log(tx);

    })
    it("Should create collateral reservation", async () => {
        // get agent
        const agentBot = await findAgentBotFromDB(agentVaultAddress, context, orm);
        expect(agentBot.agent.underlyingAddress).is.not.null;
        expect(agentBot.agent.ownerAddress).to.eq(ownerAddress);
        // create minter
        const minter = await createTestMinter(context, minterAddress);
        // reserve collateral
        const lots = 1;
        const crt = await minter.reserveCollateral(agentVaultAddress, lots);
        // pay
        const txHash = await minter.performMintingPayment(crt);
        console.log(txHash);
        await agentBot.runStep(orm.em);
    });

});