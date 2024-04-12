import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { readFileSync } from "fs";
import { Secrets, indexerApiKey } from "../../../src/config";
import { createAttestationHelper, createBlockchainIndexerHelper, createBlockchainWalletHelper, createBotConfig, createBotFAssetConfig, createStateConnectorClient } from "../../../src/config/BotConfig";
import { loadConfigFile } from "../../../src/config/config-file-loader";
import { BotConfigFile } from "../../../src/config/config-files/BotConfigFile";
import { createWalletClient, decodedChainId, supportedSourceId } from "../../../src/config/create-wallet-client";
import { SourceId } from "../../../src/underlying-chain/SourceId";
import { initWeb3 } from "../../../src/utils/web3";
import { ATTESTATION_PROVIDER_URLS, COSTON_CONTRACTS_MISSING_SC, COSTON_RPC, COSTON_RUN_CONFIG_CONTRACTS, COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS, OWNER_ADDRESS, STATE_CONNECTOR_ADDRESS, STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS, TEST_SECRETS } from "../../test-utils/test-bot-config";
import { getNativeAccounts } from "../../test-utils/test-helpers";
use(chaiAsPromised);

const indexerTestBTCUrl = "https://attestation-coston.aflabs.net/verifier/btc/";
const indexerTestDOGEUrl = "https://attestation-coston.aflabs.net/verifier/doge/";
const indexerTestXRPUrl = "https://attestation-coston.aflabs.net/verifier/xrp";
const walletTestBTCUrl = "https://api.bitcore.io/api/BTC/testnet/";
const walletTestDOGEUrl = "https://api.bitcore.io/api/DOGE/testnet/";
const walletBTCUrl = "https://api.bitcore.io/api/BTC/mainnet/";
const walletDOGEUrl = "https://api.bitcore.io/api/DOGE/mainnet/";
const walletTestXRPUrl = "https://s.altnet.rippletest.net:51234";
const walletXRPUrl = "https://s1.ripple.com:51234/";

describe("Bot config tests", () => {
    let secrets: Secrets;
    let runConfig: BotConfigFile;
    let actorRunConfig: BotConfigFile;
    let accounts: string[];

    before(async () => {
        secrets = Secrets.load(TEST_SECRETS);
        runConfig = loadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        actorRunConfig = loadConfigFile(COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS);
        accounts = await initWeb3(COSTON_RPC, getNativeAccounts(secrets), null);
    });

    it("Should create bot config", async () => {
        const botConfig = await createBotConfig("agent", secrets, runConfig, accounts[0]);
        expect(botConfig.loopDelay).to.eq(runConfig.loopDelay);
        expect(botConfig.contractRetriever.contracts).to.not.be.null;
        expect(botConfig.orm).to.not.be.null;
    });

    it("Should create tracked state config", async () => {
        const trackedStateConfig = await createBotConfig("keeper", secrets, actorRunConfig, accounts[0]);
        expect(trackedStateConfig.contractRetriever.contracts).to.not.be.null;
    });

    it("Should create wallet clients", async () => {
        const testBTC = createWalletClient(secrets, SourceId.testBTC, walletTestBTCUrl);
        expect(testBTC.chainType).to.eq(SourceId.testBTC);
        const testDOGE = createWalletClient(secrets, SourceId.testDOGE, walletTestDOGEUrl);
        expect(testDOGE.chainType).to.eq(SourceId.testDOGE);
        const testXRP = createWalletClient(secrets, SourceId.testXRP, walletTestXRPUrl);
        expect(testXRP.chainType).to.eq(SourceId.testXRP);
        const btc = createWalletClient(secrets, SourceId.BTC, walletBTCUrl);
        expect(btc.chainType).to.eq(SourceId.BTC);
        const doge = createWalletClient(secrets, SourceId.DOGE, walletDOGEUrl);
        expect(doge.chainType).to.eq(SourceId.DOGE);
        const xrp = createWalletClient(secrets, SourceId.XRP, walletXRPUrl);
        expect(xrp.chainType).to.eq(SourceId.XRP);
        const invalidSourceId = SourceId.ALGO;
        const fn = () => {
            return createWalletClient(secrets, invalidSourceId, "");
        };
        expect(fn).to.throw(`SourceId ${decodedChainId(invalidSourceId)} not supported.`);
    });

    it("Should create block chain indexer", async () => {
        const btc = createBlockchainIndexerHelper(SourceId.testBTC, indexerTestBTCUrl, indexerApiKey(secrets));
        expect(btc.sourceId).to.eq(SourceId.testBTC);
        const doge = createBlockchainIndexerHelper(SourceId.testDOGE, indexerTestDOGEUrl, indexerApiKey(secrets));
        expect(doge.sourceId).to.eq(SourceId.testDOGE);
        const xrp = createBlockchainIndexerHelper(SourceId.testXRP, indexerTestXRPUrl, indexerApiKey(secrets));
        expect(xrp.sourceId).to.eq(SourceId.testXRP);
        const sourceId = SourceId.LTC;
        const fn = () => {
            return createBlockchainIndexerHelper(sourceId, "", indexerApiKey(secrets));
        };
        expect(fn).to.throw(`SourceId ${decodedChainId(sourceId)} not supported.`);
    });

    it("Should create block chain wallet helper", async () => {
        const botConfig = await createBotConfig("agent", secrets, runConfig, accounts[0]);
        const btc = createBlockchainWalletHelper("agent", secrets, SourceId.testBTC, botConfig.orm.em, walletTestBTCUrl);
        expect(btc.walletClient.chainType).to.eq(SourceId.testBTC);
        const doge = createBlockchainWalletHelper("agent", secrets, SourceId.testDOGE, botConfig.orm.em, walletTestDOGEUrl);
        expect(doge.walletClient.chainType).to.eq(SourceId.testDOGE);
        const xrp = createBlockchainWalletHelper("user", secrets, SourceId.testXRP, undefined, walletTestXRPUrl);
        expect(xrp.walletClient.chainType).to.eq(SourceId.testXRP);
        const invalidSourceId = SourceId.ALGO;
        const fn = () => {
            return createBlockchainWalletHelper("agent", secrets, invalidSourceId, botConfig.orm.em, "");
        };
        expect(fn).to.throw(`SourceId ${decodedChainId(invalidSourceId)} not supported.`);
    });

    it("Should create attestation helper", async () => {
        const btc = await createAttestationHelper(
            SourceId.testBTC,
            ATTESTATION_PROVIDER_URLS,
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            OWNER_ADDRESS,
            indexerTestBTCUrl,
            indexerApiKey(secrets),
        );
        expect(btc.chainId).to.eq(SourceId.testBTC);
        const doge = await createAttestationHelper(
            SourceId.testDOGE,
            ATTESTATION_PROVIDER_URLS,
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            OWNER_ADDRESS,
            indexerTestDOGEUrl,
            indexerApiKey(secrets),
        );
        expect(doge.chainId).to.eq(SourceId.testDOGE);
        const xrp = await createAttestationHelper(
            SourceId.testXRP,
            ATTESTATION_PROVIDER_URLS,
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            OWNER_ADDRESS,
            indexerTestXRPUrl,
            indexerApiKey(secrets),
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
                indexerApiKey(secrets),
            )
        )
            .to.eventually.be.rejectedWith(`SourceId ${unsupportedSourceId} not supported.`)
            .and.be.an.instanceOf(Error);
    });

    it("Should create state connector helper", async () => {
        const stateConnector = await createStateConnectorClient(
            indexerTestXRPUrl,
            indexerApiKey(secrets),
            ATTESTATION_PROVIDER_URLS,
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            OWNER_ADDRESS
        );
        expect(stateConnector.account).to.eq(OWNER_ADDRESS);
    });

    it("Should create agent bot config chain", async () => {
        const botConfig = await createBotConfig("agent", secrets, runConfig, accounts[0]);
        const [symbol, chainInfo] = Object.entries(runConfig.fAssets)[0];
        const agentBotConfigChain = await createBotFAssetConfig(
            "agent",
            secrets,
            botConfig.contractRetriever,
            symbol,
            chainInfo,
            botConfig.orm!.em,
            ATTESTATION_PROVIDER_URLS,
            OWNER_ADDRESS
        );
        expect(agentBotConfigChain.stateConnector).not.be.null;
    });

    it("Should return supported source id", () => {
        expect(supportedSourceId(SourceId.ALGO)).to.be.false;
        expect(supportedSourceId(SourceId.LTC)).to.be.false;
        expect(supportedSourceId(SourceId.XRP)).to.be.true;
        expect(supportedSourceId(SourceId.DOGE)).to.be.true;
        expect(supportedSourceId(SourceId.BTC)).to.be.true;
        expect(supportedSourceId(SourceId.testXRP)).to.be.true;
        expect(supportedSourceId(SourceId.testDOGE)).to.be.true;
        expect(supportedSourceId(SourceId.testBTC)).to.be.true;
    });

    it("Should not create config - assetManager or fAssetSymbol must be defined", async () => {
        const runConfigFile1 = "./test-hardhat/test-utils/run-config-tests/run-config-missing-contracts-and-addressUpdater.json";
        runConfig = JSON.parse(readFileSync(runConfigFile1).toString()) as BotConfigFile;
        await expect(createBotConfig("common", secrets, runConfig, accounts[0]))
            .to.eventually.be.rejectedWith("At least one of contractsJsonFile or assetManagerController must be defined")
            .and.be.an.instanceOf(Error);
    });

    it("Should not create config missing StateConnector contract", async () => {
        runConfig = loadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        runConfig.contractsJsonFile = COSTON_CONTRACTS_MISSING_SC;
        await expect(createBotConfig("keeper", secrets, runConfig, accounts[0]))
            .to.eventually.be.rejectedWith("Cannot find address for contract StateConnector")
            .and.be.an.instanceOf(Error);
        // should be fine for common
        await createBotConfig("common", secrets, runConfig, accounts[0]);
    });
});
