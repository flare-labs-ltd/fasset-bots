import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import spies from "chai-spies";
import { AgentBotCommands } from "../../../src/commands/AgentBotCommands";
import { loadAgentSettings } from "../../../src/config/AgentVaultInitSettings";
import { SourceId } from "../../../src/underlying-chain/SourceId";
import { requireEnv } from "../../../src/utils";
import { initWeb3 } from "../../../src/utils/web3";
import { DEFAULT_POOL_TOKEN_SUFFIX } from "../../../test-hardhat/test-utils/helpers";
import { COSTON_RPC, COSTON_TEST_AGENT_SETTINGS } from "../../test-utils/test-bot-config";
import { getNativeAccountsFromEnv } from "../../test-utils/test-helpers";
use(chaiAsPromised);
use(spies);

const fassetBotConfig: string = requireEnv("FASSET_BOT_CONFIG");
const fAssetSymbol = "FtestXRP";

describe("AgentBot cli commands unit tests", () => {
    let accounts: string[];
    let ownerAddress: string;

    before(async () => {
        accounts = await initWeb3(COSTON_RPC, getNativeAccountsFromEnv(), null);
        ownerAddress = accounts[0];
    });

    it("Should create commands", async () => {
        const commands = await AgentBotCommands.create(fassetBotConfig, fAssetSymbol);
        const chainConfig = commands.botConfig.fAssets.get(fAssetSymbol);
        expect(chainConfig!.chainInfo.chainId).to.eq(SourceId.testXRP);
    });

    it("Should initialize bot cli commands", async () => {
        const botCliCommands = new AgentBotCommands();
        expect(botCliCommands.botConfig).to.be.undefined;
        expect(botCliCommands.context).to.be.undefined;
        expect(botCliCommands.owner).to.be.undefined;
        await botCliCommands.initEnvironment(fassetBotConfig, fAssetSymbol);
        expect(botCliCommands.botConfig.orm).to.not.be.null;
        expect(botCliCommands.context).to.not.be.null;
        expect(botCliCommands.owner).to.not.be.null;
    });

    it.skip("Should create agent bot via bot cli commands", async () => {
        const botCliCommands = new AgentBotCommands();
        await botCliCommands.initEnvironment(fassetBotConfig, fAssetSymbol);
        const agentSettings = loadAgentSettings(COSTON_TEST_AGENT_SETTINGS);
        agentSettings.poolTokenSuffix = DEFAULT_POOL_TOKEN_SUFFIX();
        const agent = await botCliCommands.createAgentVault(agentSettings);
        expect(agent!.underlyingAddress).is.not.null;
        expect(agent!.owner.workAddress).to.eq(ownerAddress);
        // sort of clean up
        await agent!.announceDestroy();
    });

    it("Should not create  bot cli commands - invalid 'fAssetSymbol'", async () => {
        await expect(AgentBotCommands.create(fassetBotConfig, "invalidSymbol")).to.eventually.be.rejectedWith(`Invalid FAsset symbol`).and.be.an.instanceOf(Error);
    });

    it("Should create underlying account", async () => {
        const botCliCommands = new AgentBotCommands();
        await botCliCommands.initEnvironment(fassetBotConfig, fAssetSymbol);
        const data = await botCliCommands.createUnderlyingAccount();
        console.log("test generated address (not used anywhere):", data);
        expect(data.address).to.not.be.null;
        expect(data.privateKey).to.not.be.null;
    });
});
