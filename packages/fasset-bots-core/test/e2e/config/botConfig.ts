import { createAttestationHelper, createBlockchainIndexerHelper, createBlockchainWalletHelper, createBotFAssetConfig, createBotConfig, createStateConnectorClient } from "../../../src/config/BotConfig";
import { createWalletClient } from "../../../src/config/create-wallet-client";
import { updateConfigFilePaths } from "../../../src/config/config-file-loader";
import { loadConfigFile } from "../../../src/config/config-file-loader";
import { BotConfigFile } from "../../../src/config/config-files/BotConfigFile";
import { initWeb3 } from "../../../src/utils/web3";
import { ATTESTATION_PROVIDER_URLS, COSTON_CONTRACTS_MISSING_SC, COSTON_CONTRACTS_MISSING_VERIFIER, COSTON_RPC, COSTON_RUN_CONFIG_CONTRACTS, COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS, OWNER_ADDRESS, STATE_CONNECTOR_ADDRESS, STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS } from "../../test-utils/test-bot-config";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
import { getNativeAccountsFromEnv } from "../../test-utils/test-helpers";
use(chaiAsPromised);
import rewire from "rewire";
import { readFileSync } from "fs";
import { SourceId } from "../../../src/underlying-chain/SourceId";
const botConfigInternal = rewire("../../../src/config/BotConfig.ts");
const validateConfigFile = botConfigInternal.__get__("validateConfigFile");
const validateAgentConfigFile = botConfigInternal.__get__("validateAgentConfigFile");
const supportedSourceIdInt = botConfigInternal.__get__("supportedSourceId");

const indexerTestBTCUrl = "https://attestation-coston.aflabs.net/verifier/btc/";
const indexerTestDOGEUrl = "https://attestation-coston.aflabs.net/verifier/doge/";
const indexerTestXRPUrl = "https://attestation-coston.aflabs.net/verifier/xrp";
const walletTestBTCUrl = "https://api.bitcore.io/api/BTC/testnet/";
const walletTestDOGEUrl = "https://api.bitcore.io/api/DOGE/testnet/";
const walletBTCUrl = "https://api.bitcore.io/api/BTC/mainnet/";
const walletDOGEUrl = "https://api.bitcore.io/api/DOGE/mainnet/";
const walletTestXRPUrl = "https://s.altnet.rippletest.net:51234";
const walletXRPUrl = "https://s1.ripple.com:51234/";

function simpleLoadConfigFile(fpath: string) {
    const config = JSON.parse(readFileSync(fpath).toString()) as BotConfigFile;
    updateConfigFilePaths(fpath, config);
    return config;
}

describe("Bot config tests", () => {
    let runConfig: BotConfigFile;
    let actorRunConfig: BotConfigFile;
    let accounts: string[];

    before(async () => {
        runConfig = loadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        actorRunConfig = loadConfigFile(COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS);
        accounts = await initWeb3(COSTON_RPC, getNativeAccountsFromEnv(), null);
    });

    it("Should create bot config", async () => {
        const botConfig = await createBotConfig(runConfig, accounts[0]);
        expect(botConfig.loopDelay).to.eq(runConfig.loopDelay);
        expect(botConfig.contractRetriever.contracts).to.not.be.null;
        expect(botConfig.orm).to.not.be.null;
    });

    it("Should create tracked state config", async () => {
        const trackedStateConfig = await createBotConfig(actorRunConfig, accounts[0]);
        expect(trackedStateConfig.contractRetriever.contracts).to.not.be.null;
    });

    it("Should create wallet clients", async () => {
        const testBTC = createWalletClient(SourceId.testBTC, walletTestBTCUrl);
        expect(testBTC.chainType).to.eq(SourceId.testBTC);
        const testDOGE = createWalletClient(SourceId.testDOGE, walletTestDOGEUrl);
        expect(testDOGE.chainType).to.eq(SourceId.testDOGE);
        const testXRP = createWalletClient(SourceId.testXRP, walletTestXRPUrl);
        expect(testXRP.chainType).to.eq(SourceId.testXRP);
        const btc = createWalletClient(SourceId.BTC, walletBTCUrl);
        expect(btc.chainType).to.eq(SourceId.BTC);
        const doge = createWalletClient(SourceId.DOGE, walletDOGEUrl);
        expect(doge.chainType).to.eq(SourceId.DOGE);
        const xrp = createWalletClient(SourceId.XRP, walletXRPUrl);
        expect(xrp.chainType).to.eq(SourceId.XRP);
        const invalidSourceId = SourceId.ALGO;
        const fn = () => {
            return createWalletClient(invalidSourceId, "");
        };
        expect(fn).to.throw(`SourceId ${invalidSourceId} not supported.`);
    });

    it("Should create block chain indexer", async () => {
        const btc = createBlockchainIndexerHelper(SourceId.testBTC, indexerTestBTCUrl);
        expect(btc.sourceId).to.eq(SourceId.testBTC);
        const doge = createBlockchainIndexerHelper(SourceId.testDOGE, indexerTestDOGEUrl);
        expect(doge.sourceId).to.eq(SourceId.testDOGE);
        const xrp = createBlockchainIndexerHelper(SourceId.testXRP, indexerTestXRPUrl);
        expect(xrp.sourceId).to.eq(SourceId.testXRP);
        const sourceId = SourceId.LTC;
        const fn = () => {
            return createBlockchainIndexerHelper(sourceId, "");
        };
        expect(fn).to.throw(`SourceId ${sourceId} not supported.`);
    });

    it("Should create block chain wallet helper", async () => {
        const botConfig = await createBotConfig(runConfig, accounts[0]);
        const btc = createBlockchainWalletHelper(SourceId.testBTC, botConfig.orm!.em, walletTestBTCUrl);
        expect(btc.walletClient.chainType).to.eq(SourceId.testBTC);
        const doge = createBlockchainWalletHelper(SourceId.testDOGE, botConfig.orm!.em, walletTestDOGEUrl);
        expect(doge.walletClient.chainType).to.eq(SourceId.testDOGE);
        const xrp = createBlockchainWalletHelper(SourceId.testXRP, null, walletTestXRPUrl);
        expect(xrp.walletClient.chainType).to.eq(SourceId.testXRP);
        const invalidSourceId = SourceId.ALGO;
        const fn = () => {
            return createBlockchainWalletHelper(invalidSourceId, botConfig.orm!.em, "");
        };
        expect(fn).to.throw(`SourceId ${invalidSourceId} not supported.`);
    });

    it("Should create attestation helper", async () => {
        const btc = await createAttestationHelper(
            SourceId.testBTC,
            ATTESTATION_PROVIDER_URLS,
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            OWNER_ADDRESS,
            indexerTestBTCUrl,
        );
        expect(btc.chainId).to.eq(SourceId.testBTC);
        const doge = await createAttestationHelper(
            SourceId.testDOGE,
            ATTESTATION_PROVIDER_URLS,
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            OWNER_ADDRESS,
            indexerTestDOGEUrl,
        );
        expect(doge.chainId).to.eq(SourceId.testDOGE);
        const xrp = await createAttestationHelper(
            SourceId.testXRP,
            ATTESTATION_PROVIDER_URLS,
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            OWNER_ADDRESS,
            indexerTestXRPUrl,
        );
        expect(xrp.chainId).to.eq(SourceId.testXRP);
        const unsupportedSourceId = SourceId.ALGO;
        await expect(
            createAttestationHelper(
                unsupportedSourceId,
                ATTESTATION_PROVIDER_URLS,
                STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
                STATE_CONNECTOR_ADDRESS,
                OWNER_ADDRESS,
                indexerTestXRPUrl,
            )
        )
            .to.eventually.be.rejectedWith(`SourceId ${unsupportedSourceId} not supported.`)
            .and.be.an.instanceOf(Error);
    });

    it("Should create state connector helper", async () => {
        const stateConnector = await createStateConnectorClient(
            indexerTestXRPUrl,
            ATTESTATION_PROVIDER_URLS,
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            OWNER_ADDRESS
        );
        expect(stateConnector.account).to.eq(OWNER_ADDRESS);
    });

    it("Should create agent bot config chain", async () => {
        const botConfig = await createBotConfig(runConfig, accounts[0]);
        const chainInfo = runConfig.fAssetInfos[0];
        const agentBotConfigChain = await createBotFAssetConfig(
            botConfig.contractRetriever,
            chainInfo,
            botConfig.orm!.em,
            ATTESTATION_PROVIDER_URLS,
            OWNER_ADDRESS
        );
        expect(agentBotConfigChain.stateConnector).not.be.null;
    });

    it("Should not validate config - contractsJsonFile or addressUpdater must be defined", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        runConfig.contractsJsonFile = undefined;
        runConfig.assetManagerController = undefined;
        const fn = () => {
            return validateConfigFile(runConfig);
        };
        expect(fn).to.throw(`Missing either contractsJsonFile or addressUpdater in config`);
    });

    it("Should not validate config - walletUrl must be defined", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        runConfig.fAssetInfos[0].walletUrl = undefined;
        const fn = () => {
            return validateAgentConfigFile(runConfig);
        };
        expect(fn).to.throw(`Missing walletUrl in FAsset type ${runConfig.fAssetInfos[0].fAssetSymbol}`);
    });

    it("Should return supported source id", () => {
        expect(supportedSourceIdInt(SourceId.ALGO)).to.be.false;
        expect(supportedSourceIdInt(SourceId.LTC)).to.be.false;
        expect(supportedSourceIdInt(SourceId.XRP)).to.be.true;
        expect(supportedSourceIdInt(SourceId.DOGE)).to.be.true;
        expect(supportedSourceIdInt(SourceId.BTC)).to.be.true;
        expect(supportedSourceIdInt(SourceId.testXRP)).to.be.true;
        expect(supportedSourceIdInt(SourceId.testDOGE)).to.be.true;
        expect(supportedSourceIdInt(SourceId.testBTC)).to.be.true;
    });

    it("Should not create config - assetManager or fAssetSymbol must be defined", async () => {
        const runConfigFile1 = "./test-hardhat/test-utils/run-config-tests/run-config-missing-contracts-and-addressUpdater.json";
        runConfig = JSON.parse(readFileSync(runConfigFile1).toString()) as BotConfigFile;
        await expect(createBotConfig(runConfig, accounts[0]))
            .to.eventually.be.rejectedWith("Either contractsJsonFile or addressUpdater must be defined")
            .and.be.an.instanceOf(Error);
    });

    it("Should not create config missing StateConnector contract", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        runConfig.contractsJsonFile = COSTON_CONTRACTS_MISSING_SC;
        await expect(createBotConfig(runConfig, accounts[0]))
            .to.eventually.be.rejectedWith("Cannot find address for StateConnector")
            .and.be.an.instanceOf(Error);
    });

    it("Should not create config missing SCProofVerifier contract", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        runConfig.contractsJsonFile = COSTON_CONTRACTS_MISSING_VERIFIER;
        await expect(createBotConfig(runConfig, accounts[0]))
            .to.eventually.be.rejectedWith("Cannot find address for SCProofVerifier")
            .and.be.an.instanceOf(Error);
    });
});
