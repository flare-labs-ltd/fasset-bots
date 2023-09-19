import { expect, use } from "chai";
import { BotCliCommands } from "../../../src/actors/AgentBotCliCommands";
import { initWeb3 } from "../../../src/utils/web3";
import spies from "chai-spies";
import { getNativeAccountsFromEnv } from "../../test-utils/test-helpers";
import { COSTON_RPC } from "../../test-utils/test-bot-config";
import { SourceId } from "../../../src/verification/sources/sources";
import chaiAsPromised from "chai-as-promised";
use(chaiAsPromised);
use(spies);

const fAssetSymbol = "FtestXRP";
describe("AgentBot cli commands unit tests", async () => {
    let botCliCommands: BotCliCommands;
    let accounts: string[];
    let ownerAddress: string;

    before(async () => {
        accounts = await initWeb3(COSTON_RPC, getNativeAccountsFromEnv(), null);
        ownerAddress = accounts[0];
    });

    it("Should create commands", async () => {
        const commands = await BotCliCommands.create(fAssetSymbol);
        expect(commands.botConfig.fAssets[0].chainInfo.chainId).to.eq(SourceId.XRP);
    });

    it("Should initialize bot cli commands", async () => {
        botCliCommands = new BotCliCommands();
        expect(botCliCommands.botConfig).to.be.undefined;
        expect(botCliCommands.context).to.be.undefined;
        expect(botCliCommands.ownerAddress).to.be.undefined;
        await botCliCommands.initEnvironment(fAssetSymbol);
        expect(botCliCommands.botConfig.orm).to.not.be.null;
        expect(botCliCommands.context).to.not.be.null;
        expect(botCliCommands.ownerAddress).to.not.be.null;
    });

    it("Should create agent bot via bot cli commands", async () => {
        botCliCommands = new BotCliCommands();
        await botCliCommands.initEnvironment(fAssetSymbol);
        const agent = await botCliCommands.createAgentVault();
        expect(agent!.underlyingAddress).is.not.null;
        expect(agent!.ownerAddress).to.eq(ownerAddress);
        // sort of clean up
        await agent!.announceDestroy();
    });

    it("Should not create  bot cli commands - invalid 'fAssetSymbol'", async () => {
        await expect(BotCliCommands.create("invalidSymbol")).to.eventually.be.rejectedWith(`Invalid FAsset symbol`).and.be.an.instanceOf(Error);
    });
});

describe("AgentBot cli commands unit tests", async () => {
    let botCliCommands: BotCliCommands;
    let accounts: string[];
    let ownerAddress: string;
    let envOrig: string;

    before(async () => {
        accounts = await initWeb3(COSTON_RPC, getNativeAccountsFromEnv(), null);
        ownerAddress = accounts[0];
        envOrig = JSON.stringify(process.env);
        process.env.OWNER_UNDERLYING_ADDRESS = "OwnerUnderlyingAddress";
        process.env.OWNER_UNDERLYING_PRIVATE_KEY = "OwnerUnderlyingPrivateKey";
    });

    after(() => {
        process.env = JSON.parse(envOrig);
    });

    it("Should not create agent bot via bot cli commands", async () => {
        botCliCommands = new BotCliCommands();
        await botCliCommands.initEnvironment(fAssetSymbol);
        const agent = await botCliCommands.createAgentVault();
        expect(agent).to.be.null;
    });
});
