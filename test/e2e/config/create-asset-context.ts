import { readFileSync } from "fs";
import { BotConfig, BotConfigFile, createBotConfig } from "../../../src/config/BotConfig";
import { createActorAssetContext, createAssetContext } from "../../../src/config/create-asset-context";
import { IAssetAgentBotContext, IAssetActorContext } from "../../../src/fasset-bots/IAssetBotContext";
import {
    COSTON_RPC,
    COSTON_RUN_CONFIG_ADDRESS_UPDATER,
    COSTON_RUN_CONFIG_CONTRACTS,
    COSTON_SIMPLIFIED_RUN_CONFIG_ADDRESS_UPDATER,
    COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS,
} from "../../test-utils/test-bot-config";
import rewire from "rewire";
const createAssetContextInternal = rewire("../../../src/config/create-asset-context");
const getAssetManagerAndController = createAssetContextInternal.__get__("getAssetManagerAndController");
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
import { artifacts, initWeb3 } from "../../../src/utils/web3";
import { getNativeAccountsFromEnv } from "../../test-utils/test-helpers";
use(chaiAsPromised);

const AddressUpdater = artifacts.require("AddressUpdater");

describe("Create asset context tests", async () => {
    let runConfig: BotConfigFile;
    let botConfig: BotConfig;
    let actorRunConfig: BotConfigFile;
    let actorConfig: BotConfig;
    let accounts: string[];

    before(async () => {
        accounts = await initWeb3(COSTON_RPC, getNativeAccountsFromEnv(), null);
    });

    it("Should create asset context from contracts", async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_CONTRACTS).toString()) as BotConfigFile;
        botConfig = await createBotConfig(runConfig, accounts[0]);
        const context: IAssetAgentBotContext = await createAssetContext(botConfig, botConfig.chains[0]);
        expect(context).is.not.null;
        expect(context.chainInfo.chainId).to.eq(botConfig.chains[0].chainInfo.chainId);
    });

    it("Should create asset context from address updater", async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_ADDRESS_UPDATER).toString()) as BotConfigFile;
        botConfig = await createBotConfig(runConfig, accounts[0]);
        const context: IAssetAgentBotContext = await createAssetContext(botConfig, botConfig.chains[0]);
        expect(context).is.not.null;
        expect(context.chainInfo.chainId).to.eq(botConfig.chains[0].chainInfo.chainId);
    });

    it("Should not create asset context - contractsJsonFile or addressUpdater must be defined", async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_CONTRACTS).toString()) as BotConfigFile;
        runConfig.addressUpdater = undefined;
        runConfig.contractsJsonFile = undefined;
        botConfig = await createBotConfig(runConfig, accounts[0]);
        await expect(createAssetContext(botConfig, botConfig.chains[0]))
            .to.eventually.be.rejectedWith("Either contractsJsonFile or addressUpdater must be defined")
            .and.be.an.instanceOf(Error);
    });

    it("Should not create asset context - wallet must be defined in chain config", async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_CONTRACTS).toString()) as BotConfigFile;
        botConfig = await createBotConfig(runConfig, accounts[0]);
        botConfig.chains[0].wallet = undefined;
        await expect(createAssetContext(botConfig, botConfig.chains[0]))
            .to.eventually.be.rejectedWith("Missing wallet configuration")
            .and.be.an.instanceOf(Error);
    });

    it("Should create simplified asset context from contracts", async () => {
        actorRunConfig = JSON.parse(readFileSync(COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS).toString()) as BotConfigFile;
        actorConfig = await createBotConfig(actorRunConfig, accounts[0]);
        const context: IAssetActorContext = await createActorAssetContext(actorConfig, actorConfig.chains[0]);
        expect(context).is.not.null;
    });

    it("Should create simplified asset context from address updater", async () => {
        actorRunConfig = JSON.parse(readFileSync(COSTON_SIMPLIFIED_RUN_CONFIG_ADDRESS_UPDATER).toString()) as BotConfigFile;
        actorConfig = await createBotConfig(actorRunConfig, accounts[0]);
        const context: IAssetActorContext = await createActorAssetContext(actorConfig, actorConfig.chains[0]);
        expect(context).is.not.null;
    });

    it("Should not create asset context - contractsJsonFile or addressUpdater must be defined", async () => {
        actorRunConfig = JSON.parse(readFileSync(COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS).toString()) as BotConfigFile;
        actorRunConfig.addressUpdater = undefined;
        actorRunConfig.contractsJsonFile = undefined;
        actorConfig = await createBotConfig(actorRunConfig, accounts[0]);
        await expect(createActorAssetContext(actorConfig, actorConfig.chains[0]))
            .to.eventually.be.rejectedWith("Either contractsJsonFile or addressUpdater must be defined")
            .and.be.an.instanceOf(Error);
    });

    it("Should not create asset context - assetManager or fAssetSymbol required in chain config", async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_CONTRACTS).toString()) as BotConfigFile;
        botConfig = await createBotConfig(runConfig, accounts[0]);
        botConfig.chains[0].assetManager = undefined;
        botConfig.chains[0].fAssetSymbol = undefined;
        await expect(createAssetContext(botConfig, botConfig.chains[0]))
            .to.eventually.be.rejectedWith("assetManager or fAssetSymbol required in chain config")
            .and.be.an.instanceOf(Error);
    });

    it("Should not create asset context - FAsset symbol not found", async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_CONTRACTS).toString()) as BotConfigFile;
        botConfig = await createBotConfig(runConfig, accounts[0]);
        botConfig.chains[0].assetManager = undefined;
        botConfig.chains[0].fAssetSymbol = "RandomAsset";
        await expect(createAssetContext(botConfig, botConfig.chains[0]))
            .to.eventually.be.rejectedWith(`FAsset symbol ${botConfig.chains[0].fAssetSymbol} not found`)
            .and.be.an.instanceOf(Error);
    });

    it("Should not create asset context - either addressUpdater or contracts must be defined", async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_CONTRACTS).toString()) as BotConfigFile;
        botConfig = await createBotConfig(runConfig, accounts[0]);
        await expect(getAssetManagerAndController(botConfig.chains[0], null, null))
            .to.eventually.be.rejectedWith(`Either addressUpdater or contracts must be defined`)
            .and.be.an.instanceOf(Error);
    });

    //skip TODO until AssetManagerController gets verified in explorer
    it.skip("Should get asset manager and controller with address updater", async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_ADDRESS_UPDATER).toString()) as BotConfigFile;
        botConfig = await createBotConfig(runConfig, accounts[0]);
        botConfig.chains[0].assetManager = undefined;
        botConfig.chains[0].fAssetSymbol = "FtestXRP";
        const addressUpdater = await AddressUpdater.at(botConfig.addressUpdater!);
        const [assetManager, assetManagerController] = await getAssetManagerAndController(botConfig.chains[0], addressUpdater, null);
        expect(assetManager).to.not.be.null;
        expect(assetManagerController).to.not.be.null;
    });
});
