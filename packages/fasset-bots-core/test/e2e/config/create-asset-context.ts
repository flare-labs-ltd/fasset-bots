import { readFileSync } from "fs";
import { BotConfig, createBotConfig, updateConfigFilePaths } from "../../../src/config/BotConfig";
import { BotConfigFile } from "../../../src/config/config-files";
import { createActorAssetContext, createAssetContext } from "../../../src/config/create-asset-context";
import { IAssetAgentBotContext, IAssetActorContext } from "../../../src/fasset-bots/IAssetBotContext";
import { COSTON_RPC, COSTON_RUN_CONFIG_ADDRESS_UPDATER, COSTON_RUN_CONFIG_CONTRACTS, COSTON_SIMPLIFIED_RUN_CONFIG_ADDRESS_UPDATER, COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS } from "../../test-utils/test-bot-config";
import rewire from "rewire";
const createAssetContextInternal = rewire("../../../src/config/create-asset-context");
const getAssetManagerAndController = createAssetContextInternal.__get__("getAssetManagerAndController");
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
import { artifacts, initWeb3 } from "../../../src/utils/web3";
import { getNativeAccountsFromEnv } from "../../test-utils/test-helpers";
import { ActorBaseKind } from "../../../src/fasset-bots/ActorBase";
use(chaiAsPromised);

const AddressUpdater = artifacts.require("AddressUpdater");

function simpleLoadConfigFile(fpath: string) {
    const config = JSON.parse(readFileSync(fpath).toString()) as BotConfigFile;
    updateConfigFilePaths(fpath, config);
    return config;
}

describe("Create asset context tests",  () => {
    let runConfig: BotConfigFile;
    let botConfig: BotConfig;
    let actorRunConfig: BotConfigFile;
    let actorConfig: BotConfig;
    let accounts: string[];

    before(async () => {
        accounts = await initWeb3(COSTON_RPC, getNativeAccountsFromEnv(), null);
    });

    it("Should create asset context from contracts", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        botConfig = await createBotConfig(runConfig, accounts[0]);
        const context: IAssetAgentBotContext = await createAssetContext(botConfig, botConfig.fAssets[0]);
        expect(context).is.not.null;
        expect(context.chainInfo.chainId).to.eq(botConfig.fAssets[0].chainInfo.chainId);
    });

    // with addressUpdater and stateConnectorProofVerifierAddress - cannot use only addressUpdater until SCProofVerifier gets verified in explorer
    it("Should create asset context from address updater", async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_ADDRESS_UPDATER).toString()) as BotConfigFile;
        botConfig = await createBotConfig(runConfig, accounts[0]);
        const context: IAssetAgentBotContext = await createAssetContext(botConfig, botConfig.fAssets[0]);
        expect(context).is.not.null;
        expect(context.chainInfo.chainId).to.eq(botConfig.fAssets[0].chainInfo.chainId);
    });

    it("Should not create asset context - wallet must be defined in chain config", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        botConfig = await createBotConfig(runConfig, accounts[0]);
        botConfig.fAssets[0].wallet = undefined;
        await expect(createAssetContext(botConfig, botConfig.fAssets[0]))
            .to.eventually.be.rejectedWith("Missing wallet configuration")
            .and.be.an.instanceOf(Error);
    });

    it("Should not create asset context - state connector must be defined in chain config", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        botConfig = await createBotConfig(runConfig, accounts[0]);
        botConfig.fAssets[0].stateConnector = undefined;
        await expect(createAssetContext(botConfig, botConfig.fAssets[0]))
            .to.eventually.be.rejectedWith("Missing state connector configuration")
            .and.be.an.instanceOf(Error);
    });

    it("Should not create asset context - blockchain indexer must be defined in chain config", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        botConfig = await createBotConfig(runConfig, accounts[0]);
        botConfig.fAssets[0].blockchainIndexerClient = undefined;
        await expect(createAssetContext(botConfig, botConfig.fAssets[0]))
            .to.eventually.be.rejectedWith("Missing blockchain indexer configuration")
            .and.be.an.instanceOf(Error);
    });

    it("Should create simplified asset context from contracts", async () => {
        actorRunConfig = simpleLoadConfigFile(COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS);
        actorConfig = await createBotConfig(actorRunConfig, accounts[0]);
        const context: IAssetActorContext = await createActorAssetContext(actorConfig, actorConfig.fAssets[0], ActorBaseKind.CHALLENGER);
        expect(context).is.not.null;
    });

    // with addressUpdater and stateConnectorProofVerifierAddress - cannot use only addressUpdater until SCProofVerifier gets verified in explorer
    it("Should create simplified asset context from address updater", async () => {
        actorRunConfig = simpleLoadConfigFile(COSTON_SIMPLIFIED_RUN_CONFIG_ADDRESS_UPDATER);
        actorConfig = await createBotConfig(actorRunConfig, accounts[0]);
        const context: IAssetActorContext = await createActorAssetContext(actorConfig, actorConfig.fAssets[0], ActorBaseKind.TIME_KEEPER);
        expect(context).is.not.null;
    });

    // with addressUpdater and stateConnectorProofVerifierAddress - cannot use only addressUpdater until SCProofVerifier gets verified in explorer
    it("Should create simplified asset context from address updater and not define attestationProvider", async () => {
        actorRunConfig = simpleLoadConfigFile(COSTON_SIMPLIFIED_RUN_CONFIG_ADDRESS_UPDATER);
        actorRunConfig.attestationProviderUrls = undefined;
        actorRunConfig.fAssetInfos[0].indexerUrl = undefined;
        actorConfig = await createBotConfig(actorRunConfig, accounts[0]);
        const context: IAssetActorContext = await createActorAssetContext(actorConfig, actorConfig.fAssets[0], ActorBaseKind.LIQUIDATOR);
        expect(context).is.not.null;
        expect(context.attestationProvider).to.be.undefined;
    });

    it("Should not create asset context - contractsJsonFile or addressUpdater must be defined", async () => {
        actorRunConfig = simpleLoadConfigFile(COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS);
        actorConfig = await createBotConfig(actorRunConfig, accounts[0]);
        actorConfig.addressUpdater = undefined;
        actorConfig.contractsJsonFile = undefined;
        await expect(createActorAssetContext(actorConfig, actorConfig.fAssets[0], ActorBaseKind.CHALLENGER))
            .to.eventually.be.rejectedWith("Either contractsJsonFile or addressUpdater must be defined")
            .and.be.an.instanceOf(Error);
    });

    it("Should not create asset context - assetManager or fAssetSymbol required in chain config", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        botConfig = await createBotConfig(runConfig, accounts[0]);
        botConfig.fAssets[0].assetManager = undefined;
        botConfig.fAssets[0].fAssetSymbol = undefined;
        await expect(createAssetContext(botConfig, botConfig.fAssets[0]))
            .to.eventually.be.rejectedWith("assetManager or fAssetSymbol required in chain config")
            .and.be.an.instanceOf(Error);
    });

    it("Should not create asset context - FAsset symbol not found", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        botConfig = await createBotConfig(runConfig, accounts[0]);
        botConfig.fAssets[0].assetManager = undefined;
        botConfig.fAssets[0].fAssetSymbol = "RandomAsset";
        await expect(createAssetContext(botConfig, botConfig.fAssets[0]))
            .to.eventually.be.rejectedWith(`FAsset symbol ${botConfig.fAssets[0].fAssetSymbol} not found`)
            .and.be.an.instanceOf(Error);
    });

    it("Should not create actor asset context - blockchain indexer must be defined in chain config", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        botConfig = await createBotConfig(runConfig, accounts[0]);
        botConfig.fAssets[0].blockchainIndexerClient = undefined;
        await expect(createActorAssetContext(botConfig, botConfig.fAssets[0], ActorBaseKind.CHALLENGER))
            .to.eventually.be.rejectedWith(`Missing blockchain indexer configuration`)
            .and.be.an.instanceOf(Error);
        await expect(createActorAssetContext(botConfig, botConfig.fAssets[0], ActorBaseKind.TIME_KEEPER))
            .to.eventually.be.rejectedWith(`Missing blockchain indexer configuration`)
            .and.be.an.instanceOf(Error);
    });

    it("Should not create actor asset context - state connector must be defined in chain config", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        botConfig = await createBotConfig(runConfig, accounts[0]);
        botConfig.fAssets[0].stateConnector = undefined;
        await expect(createActorAssetContext(botConfig, botConfig.fAssets[0], ActorBaseKind.CHALLENGER))
            .to.eventually.be.rejectedWith(`Missing state connector configuration`)
            .and.be.an.instanceOf(Error);
        await expect(createActorAssetContext(botConfig, botConfig.fAssets[0], ActorBaseKind.TIME_KEEPER))
            .to.eventually.be.rejectedWith(`Missing state connector configuration`)
            .and.be.an.instanceOf(Error);
    });

    it("Should not create asset context - either addressUpdater or contracts must be defined", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        botConfig = await createBotConfig(runConfig, accounts[0]);
        await expect(getAssetManagerAndController(botConfig.fAssets[0], null, null))
            .to.eventually.be.rejectedWith(`Either addressUpdater or contracts must be defined`)
            .and.be.an.instanceOf(Error);
    });

    it("Should not create asset context - contractsJsonFile or addressUpdater must be defined", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        botConfig = await createBotConfig(runConfig, accounts[0]);
        botConfig.addressUpdater = undefined;
        botConfig.contractsJsonFile = undefined;
        await expect(createAssetContext(botConfig, botConfig.fAssets[0]))
            .to.eventually.be.rejectedWith("Either contractsJsonFile or addressUpdater must be defined")
            .and.be.an.instanceOf(Error);
    });

    //skip TODO until AssetManagerController gets verified in explorer
    it.skip("Should get asset manager and controller with address updater", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_ADDRESS_UPDATER);
        botConfig = await createBotConfig(runConfig, accounts[0]);
        botConfig.fAssets[0].assetManager = undefined;
        botConfig.fAssets[0].fAssetSymbol = "FtestXRP";
        const addressUpdater = await AddressUpdater.at(botConfig.addressUpdater!);
        const [assetManager, assetManagerController] = await getAssetManagerAndController(botConfig.fAssets[0], addressUpdater, null);
        expect(assetManager).to.not.be.null;
        expect(assetManagerController).to.not.be.null;
    });
});
