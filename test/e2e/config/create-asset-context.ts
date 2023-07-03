import { readFileSync } from "fs";
import { AgentBotConfig, createAgentBotConfig, AgentBotRunConfig, TrackedStateConfig, TrackedStateRunConfig, createTrackedStateConfig } from "../../../src/config/BotConfig"
import { createAssetContext, createTrackedStateAssetContext } from "../../../src/config/create-asset-context";
import { IAssetAgentBotContext, IAssetTrackedStateContext } from "../../../src/fasset-bots/IAssetBotContext";
import { COSTON_RUN_CONFIG_ADDRESS_UPDATER, COSTON_RUN_CONFIG_CONTRACTS, COSTON_SIMPLIFIED_RUN_CONFIG_ADDRESS_UPDATER, COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS } from "../../test-utils/test-bot-config";
import rewire from "rewire";
const createAssetContextInternal = rewire("../../../src/config/create-asset-context");
const getAssetManagerAndController = createAssetContextInternal.__get__("getAssetManagerAndController");
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
import { initWeb3 } from "../../../src/utils/web3";
import { getNativeAccountsFromEnv } from "../../test-utils/test-actors";
import { requireEnv } from "../../../src/utils/helpers";
use(chaiAsPromised);

const RPC_URL: string = requireEnv('RPC_URL');

describe("Create asset context tests", async () => {
    let runConfig: AgentBotRunConfig;
    let botConfig: AgentBotConfig;
    let trackedStateRunConfig: TrackedStateRunConfig;
    let trackedStateConfig: TrackedStateConfig;

    before(async () => {
        await initWeb3(RPC_URL, getNativeAccountsFromEnv(), null);
    });

    it("Should create asset context from contracts", async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_CONTRACTS).toString()) as AgentBotRunConfig;
        botConfig = await createAgentBotConfig(runConfig);
        const context: IAssetAgentBotContext = await createAssetContext(botConfig, botConfig.chains[0]);
        expect(context).is.not.null;
        expect(context.chainInfo.chainId).to.eq(botConfig.chains[0].chainInfo.chainId);
    });

    it("Should create asset context from address updater", async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_ADDRESS_UPDATER).toString()) as AgentBotRunConfig;
        botConfig = await createAgentBotConfig(runConfig);
        const context: IAssetAgentBotContext = await createAssetContext(botConfig, botConfig.chains[0]);
        expect(context).is.not.null;
        expect(context.chainInfo.chainId).to.eq(botConfig.chains[0].chainInfo.chainId);
    });

    it("Should not create asset context - contractsJsonFile or addressUpdater must be defined", async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_CONTRACTS).toString()) as AgentBotRunConfig;
        runConfig.addressUpdater = undefined;
        runConfig.contractsJsonFile = undefined;
        botConfig = await createAgentBotConfig(runConfig);
        await expect(createAssetContext(botConfig, botConfig.chains[0])).to.eventually.be.rejectedWith("Either contractsJsonFile or addressUpdater must be defined").and.be.an.instanceOf(Error);
    });

    it("Should create simplified asset context from contracts", async () => {
        trackedStateRunConfig = JSON.parse(readFileSync(COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS).toString()) as TrackedStateRunConfig;
        trackedStateConfig = await createTrackedStateConfig(trackedStateRunConfig);
        const context: IAssetTrackedStateContext = await createTrackedStateAssetContext(trackedStateConfig, trackedStateConfig.chains[0]);
        expect(context).is.not.null;
    });

    it("Should create simplified asset context from address updater", async () => {
        trackedStateRunConfig = JSON.parse(readFileSync(COSTON_SIMPLIFIED_RUN_CONFIG_ADDRESS_UPDATER).toString()) as TrackedStateRunConfig;
        trackedStateConfig = await createTrackedStateConfig(trackedStateRunConfig);
        const context: IAssetTrackedStateContext = await createTrackedStateAssetContext(botConfig, botConfig.chains[0]);
        expect(context).is.not.null;
    });

    it("Should not create asset context - contractsJsonFile or addressUpdater must be defined", async () => {
        trackedStateRunConfig = JSON.parse(readFileSync(COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS).toString()) as TrackedStateRunConfig;
        trackedStateRunConfig.addressUpdater = undefined;
        trackedStateRunConfig.contractsJsonFile = undefined;
        trackedStateConfig = await createTrackedStateConfig(trackedStateRunConfig);
        await expect(createTrackedStateAssetContext(trackedStateConfig, trackedStateConfig.chains[0])).to.eventually.be.rejectedWith("Either contractsJsonFile or addressUpdater must be defined").and.be.an.instanceOf(Error);
    });

    it("Should not create asset context - assetManager or fAssetSymbol required in chain config", async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_CONTRACTS).toString()) as AgentBotRunConfig;
        botConfig = await createAgentBotConfig(runConfig);
        botConfig.chains[0].assetManager = undefined;
        botConfig.chains[0].fAssetSymbol = undefined;
        await expect(createAssetContext(botConfig, botConfig.chains[0])).to.eventually.be.rejectedWith("assetManager or fAssetSymbol required in chain config").and.be.an.instanceOf(Error);
    });

    it("Should not create asset context - FAsset symbol not found", async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_CONTRACTS).toString()) as AgentBotRunConfig;
        botConfig = await createAgentBotConfig(runConfig);
        botConfig.chains[0].assetManager = undefined;
        botConfig.chains[0].fAssetSymbol = "RandomAsset";
        await expect(createAssetContext(botConfig, botConfig.chains[0])).to.eventually.be.rejectedWith(`FAsset symbol ${botConfig.chains[0].fAssetSymbol} not found`).and.be.an.instanceOf(Error);
    });

    it("Should not create asset context - either addressUpdater or contracts must be defined", async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_CONTRACTS).toString()) as AgentBotRunConfig;
        botConfig = await createAgentBotConfig(runConfig);
        await expect(getAssetManagerAndController(botConfig.chains[0], null, null)).to.eventually.be.rejectedWith(`Either addressUpdater or contracts must be defined`).and.be.an.instanceOf(Error);
    });

});
