import { expect, use } from "chai";
import { BotCliCommands } from "../../../src/actors/AgentBotCliCommands";
import { initWeb3 } from "../../../src/utils/web3";
import spies from "chai-spies";
import { getNativeAccountsFromEnv } from "../../test-utils/test-helpers";
import { COSTON_RPC, COSTON_TEST_AGENT_SETTINGS } from "../../test-utils/test-bot-config";
import chaiAsPromised from "chai-as-promised";
import { SourceId } from "../../../src/underlying-chain/SourceId";
import { loadAgentSettings } from "../../../src/config";
import { requireEnv } from "../../../src/utils";
import { DEFAULT_POOL_TOKEN_SUFFIX } from "../../../test-hardhat/test-utils/helpers";
use(chaiAsPromised);
use(spies);

const fassetBotConfig: string = requireEnv("FASSET_BOT_CONFIG");
const fAssetSymbol = "FtestXRP";

describe("AgentBot cli commands unit tests", () => {
    let botCliCommands: BotCliCommands;
    let accounts: string[];
    let ownerAddress: string;

    before(async () => {
        accounts = await initWeb3(COSTON_RPC, getNativeAccountsFromEnv(), null);
        ownerAddress = accounts[0];
    });

    it("Should create commands", async () => {
        const commands = await BotCliCommands.create(fassetBotConfig, fAssetSymbol);
        const chainConfig = commands.botConfig.fAssets.find((cc) => cc.fAssetSymbol === fAssetSymbol);
        expect(chainConfig!.chainInfo.chainId).to.eq(SourceId.testXRP);
    });

    it("Should initialize bot cli commands", async () => {
        botCliCommands = new BotCliCommands();
        expect(botCliCommands.botConfig).to.be.undefined;
        expect(botCliCommands.context).to.be.undefined;
        expect(botCliCommands.owner).to.be.undefined;
        await botCliCommands.initEnvironment(fassetBotConfig, fAssetSymbol);
        expect(botCliCommands.botConfig.orm).to.not.be.null;
        expect(botCliCommands.context).to.not.be.null;
        expect(botCliCommands.owner).to.not.be.null;
    });

    it("Should create agent bot via bot cli commands", async () => {
        botCliCommands = new BotCliCommands();
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
        await expect(BotCliCommands.create(fassetBotConfig, "invalidSymbol")).to.eventually.be.rejectedWith(`Invalid FAsset symbol`).and.be.an.instanceOf(Error);
    });
});
