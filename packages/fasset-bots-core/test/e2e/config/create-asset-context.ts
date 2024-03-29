import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { readFileSync } from "fs";
import rewire from "rewire";
import { BotConfig, createBotConfig } from "../../../src/config/BotConfig";
import { updateConfigFilePaths } from "../../../src/config/config-file-loader";
import { BotConfigFile } from "../../../src/config/config-files/BotConfigFile";
import { createAgentBotContext, createChallengerContext, createLiquidatorContext, createTimekeeperContext } from "../../../src/config/create-asset-context";
import { IAssetAgentContext } from "../../../src/fasset-bots/IAssetBotContext";
import { firstValue } from "../../../src/utils";
import { initWeb3 } from "../../../src/utils/web3";
import { COSTON_RPC, COSTON_RUN_CONFIG_ADDRESS_UPDATER, COSTON_RUN_CONFIG_CONTRACTS, COSTON_SIMPLIFIED_RUN_CONFIG_ADDRESS_UPDATER, COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS } from "../../test-utils/test-bot-config";
import { getNativeAccountsFromEnv } from "../../test-utils/test-helpers";
use(chaiAsPromised);
const createAssetContextInternal = rewire("../../../src/config/create-asset-context");
const getAssetManagerAndController = createAssetContextInternal.__get__("getAssetManagerAndController");

function simpleLoadConfigFile(fpath: string) {
    const config = JSON.parse(readFileSync(fpath).toString()) as BotConfigFile;
    updateConfigFilePaths(fpath, config);
    return config;
}

describe("Create asset context tests", () => {
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
        const context: IAssetAgentContext = await createAgentBotContext(botConfig, firstValue(botConfig.fAssets)!);
        expect(context).is.not.null;
        expect(context.chainInfo.chainId).to.eq(firstValue(botConfig.fAssets)!.chainInfo.chainId);
    });

    // with addressUpdater and stateConnectorProofVerifierAddress - cannot use only addressUpdater until SCProofVerifier gets verified in explorer
    it("Should create asset context from address updater", async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_ADDRESS_UPDATER).toString()) as BotConfigFile;
        botConfig = await createBotConfig(runConfig, accounts[0]);
        const context: IAssetAgentContext = await createAgentBotContext(botConfig, firstValue(botConfig.fAssets)!);
        expect(context).is.not.null;
        expect(context.chainInfo.chainId).to.eq(firstValue(botConfig.fAssets)!.chainInfo.chainId);
    });

    it("Should not create asset context - wallet must be defined in chain config", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        botConfig = await createBotConfig(runConfig, accounts[0]);
        firstValue(botConfig.fAssets)!.wallet = undefined;
        await expect(createAgentBotContext(botConfig, firstValue(botConfig.fAssets)!))
            .to.eventually.be.rejectedWith("Missing wallet configuration")
            .and.be.an.instanceOf(Error);
    });

    it("Should not create asset context - state connector must be defined in chain config", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        botConfig = await createBotConfig(runConfig, accounts[0]);
        firstValue(botConfig.fAssets)!.stateConnector = undefined;
        await expect(createAgentBotContext(botConfig, firstValue(botConfig.fAssets)!))
            .to.eventually.be.rejectedWith("Missing state connector configuration")
            .and.be.an.instanceOf(Error);
    });

    it("Should not create asset context - blockchain indexer must be defined in chain config", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        botConfig = await createBotConfig(runConfig, accounts[0]);
        firstValue(botConfig.fAssets)!.blockchainIndexerClient = undefined;
        await expect(createAgentBotContext(botConfig, firstValue(botConfig.fAssets)!))
            .to.eventually.be.rejectedWith("Missing blockchain indexer configuration")
            .and.be.an.instanceOf(Error);
    });

    it("Should create simplified asset context from contracts", async () => {
        actorRunConfig = simpleLoadConfigFile(COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS);
        actorConfig = await createBotConfig(actorRunConfig, accounts[0]);
        const context = await createChallengerContext(actorConfig, firstValue(actorConfig.fAssets)!);
        expect(context).is.not.null;
    });

    // with addressUpdater and stateConnectorProofVerifierAddress - cannot use only addressUpdater until SCProofVerifier gets verified in explorer
    it("Should create simplified asset context from address updater", async () => {
        actorRunConfig = simpleLoadConfigFile(COSTON_SIMPLIFIED_RUN_CONFIG_ADDRESS_UPDATER);
        actorConfig = await createBotConfig(actorRunConfig, accounts[0]);
        const context = await createTimekeeperContext(actorConfig, firstValue(actorConfig.fAssets)!);
        expect(context).is.not.null;
    });

    // with addressUpdater and stateConnectorProofVerifierAddress - cannot use only addressUpdater until SCProofVerifier gets verified in explorer
    it("Should create simplified asset context from address updater and not define attestationProvider", async () => {
        actorRunConfig = simpleLoadConfigFile(COSTON_SIMPLIFIED_RUN_CONFIG_ADDRESS_UPDATER);
        actorRunConfig.attestationProviderUrls = undefined;
        Object.values(actorRunConfig.fAssets)[0].indexerUrl = undefined;
        actorConfig = await createBotConfig(actorRunConfig, accounts[0]);
        const context = await createLiquidatorContext(actorConfig, firstValue(actorConfig.fAssets)!);
        expect(context).is.not.null;
    });

    it("Should not create actor asset context - blockchain indexer must be defined in chain config", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        botConfig = await createBotConfig(runConfig, accounts[0]);
        firstValue(botConfig.fAssets)!.blockchainIndexerClient = undefined;
        await expect(createChallengerContext(botConfig, firstValue(botConfig.fAssets)!))
            .to.eventually.be.rejectedWith(`Missing blockchain indexer configuration`)
            .and.be.an.instanceOf(Error);
        await expect(createTimekeeperContext(botConfig, firstValue(botConfig.fAssets)!))
            .to.eventually.be.rejectedWith(`Missing blockchain indexer configuration`)
            .and.be.an.instanceOf(Error);
    });

    it("Should not create actor asset context - state connector must be defined in chain config", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        botConfig = await createBotConfig(runConfig, accounts[0]);
        firstValue(botConfig.fAssets)!.stateConnector = undefined;
        await expect(createChallengerContext(botConfig, firstValue(botConfig.fAssets)!))
            .to.eventually.be.rejectedWith(`Missing state connector configuration`)
            .and.be.an.instanceOf(Error);
        await expect(createTimekeeperContext(botConfig, firstValue(botConfig.fAssets)!))
            .to.eventually.be.rejectedWith(`Missing state connector configuration`)
            .and.be.an.instanceOf(Error);
    });

    it("Should not create asset context - either addressUpdater or contracts must be defined", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        botConfig = await createBotConfig(runConfig, accounts[0]);
        await expect(getAssetManagerAndController(firstValue(botConfig.fAssets)!, null, null))
            .to.eventually.be.rejectedWith(`Either addressUpdater or contracts must be defined`)
            .and.be.an.instanceOf(Error);
    });
});
