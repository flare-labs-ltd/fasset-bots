import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { readFileSync } from "fs";
import { Secrets, indexerApiKey } from "../../../src/config";
import { createBlockchainIndexerHelper, createBlockchainWalletHelper, createBotConfig, createBotFAssetConfig, createStateConnectorClient } from "../../../src/config/BotConfig";
import { loadConfigFile } from "../../../src/config/config-file-loader";
import { BotConfigFile } from "../../../src/config/config-files/BotConfigFile";
import { createWalletClient, supportedChainId } from "../../../src/config/create-wallet-client";
import { ChainId } from "../../../src/underlying-chain/ChainId";
import { initWeb3 } from "../../../src/utils/web3";
import { ATTESTATION_PROVIDER_URLS, COSTON_CONTRACTS_MISSING_SC, COSTON_RPC, COSTON_RUN_CONFIG_CONTRACTS, COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS, OWNER_ADDRESS, STATE_CONNECTOR_ADDRESS, STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS, TEST_SECRETS } from "../../test-utils/test-bot-config";
import { getNativeAccounts } from "../../test-utils/test-helpers";
use(chaiAsPromised);

const indexerTestBTCUrls = ["https://attestation-coston.aflabs.net/verifier/btc/"];
const indexerTestDOGEUrls = ["https://attestation-coston.aflabs.net/verifier/doge/"];
const indexerTestXRPUrls = ["https://attestation-coston.aflabs.net/verifier/xrp"];
const walletTestBTCUrls = ["https://api.bitcore.io/api/BTC/testnet/"];
const walletTestDOGEUrls = ["https://api.bitcore.io/api/DOGE/testnet/"];
const walletBTCUrls = ["https://api.bitcore.io/api/BTC/mainnet/"];
const walletDOGEUrls = ["https://api.bitcore.io/api/DOGE/mainnet/"];
const walletTestXRPUrls = ["https://s.altnet.rippletest.net:51234"];
const walletXRPUrls = ["https://s1.ripple.com:51234/"];

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
        const botConfig = await createBotConfig("agent", secrets, runConfig, accounts[0]);
        const orm = botConfig.orm!;
        const testBTC = await createWalletClient(secrets, ChainId.testBTC, walletTestBTCUrls, orm.em);
        expect(testBTC.chainType).to.eq(ChainId.testBTC.chainName);
        const testDOGE = await createWalletClient(secrets, ChainId.testDOGE, walletTestDOGEUrls, orm.em);
        expect(testDOGE.chainType).to.eq(ChainId.testDOGE.chainName);
        const testXRP = await createWalletClient(secrets, ChainId.testXRP, walletTestXRPUrls, orm.em);
        expect(testXRP.chainType).to.eq(ChainId.testXRP.chainName);
        const btc = await createWalletClient(secrets, ChainId.BTC, walletBTCUrls, orm.em);
        expect(btc.chainType).to.eq(ChainId.BTC.chainName);
        const doge = await createWalletClient(secrets, ChainId.DOGE, walletDOGEUrls, orm.em);
        expect(doge.chainType).to.eq(ChainId.DOGE.chainName);
        const xrp = await createWalletClient(secrets, ChainId.XRP, walletXRPUrls, orm.em);
        expect(xrp.chainType).to.eq(ChainId.XRP.chainName);
        const invalidSourceId = ChainId.ALGO;
        await expect(createWalletClient(secrets, invalidSourceId, [""], orm.em))
        .to.eventually.be.rejectedWith(`SourceId ${invalidSourceId} not supported.`)
        .and.be.an.instanceOf(Error);
    });

    it("Should create block chain indexer", async () => {
        const btc = createBlockchainIndexerHelper(ChainId.testBTC, indexerTestBTCUrls, indexerApiKey(secrets));
        expect(btc.chainId).to.eq(ChainId.testBTC);
        const doge = createBlockchainIndexerHelper(ChainId.testDOGE, indexerTestDOGEUrls, indexerApiKey(secrets));
        expect(doge.chainId).to.eq(ChainId.testDOGE);
        const xrp = createBlockchainIndexerHelper(ChainId.testXRP, indexerTestXRPUrls, indexerApiKey(secrets));
        expect(xrp.chainId).to.eq(ChainId.testXRP);
        const chainId = ChainId.LTC;
        const fn = () => {
            return createBlockchainIndexerHelper(chainId, [""], indexerApiKey(secrets));
        };
        expect(fn).to.throw(`SourceId ${chainId.chainName} not supported.`);
    });

    it("Should create block chain wallet helper", async () => {
        const botConfig = await createBotConfig("agent", secrets, runConfig, accounts[0]);
        const btc = await createBlockchainWalletHelper(secrets, ChainId.testBTC, botConfig.orm.em, walletTestBTCUrls);
        expect(btc.walletClient.chainType).to.eq(ChainId.testBTC.chainName);
        const doge = await createBlockchainWalletHelper(secrets, ChainId.testDOGE, botConfig.orm.em, walletTestDOGEUrls);
        expect(doge.walletClient.chainType).to.eq(ChainId.testDOGE.chainName);
        const xrp = await createBlockchainWalletHelper(secrets, ChainId.testXRP, botConfig.orm.em, walletTestXRPUrls);
        expect(xrp.walletClient.chainType).to.eq(ChainId.testXRP.chainName);
        const invalidSourceId = ChainId.ALGO;
        await expect(createBlockchainWalletHelper(secrets, invalidSourceId, botConfig.orm.em, [""]))
        .to.eventually.be.rejectedWith(`SourceId ${invalidSourceId.chainName} not supported.`)
        .and.be.an.instanceOf(Error);
    });

    it("Should create state connector helper", async () => {
        const stateConnector = await createStateConnectorClient(
            indexerTestXRPUrls,
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
            runConfig.agentBotSettings,
            botConfig.orm!.em,
            ATTESTATION_PROVIDER_URLS,
            OWNER_ADDRESS
        );
        expect(agentBotConfigChain.stateConnector).not.be.null;
    });

    it("Should return supported source id", () => {
        expect(supportedChainId(ChainId.ALGO)).to.be.false;
        expect(supportedChainId(ChainId.LTC)).to.be.false;
        expect(supportedChainId(ChainId.XRP)).to.be.true;
        expect(supportedChainId(ChainId.DOGE)).to.be.true;
        expect(supportedChainId(ChainId.BTC)).to.be.true;
        expect(supportedChainId(ChainId.testXRP)).to.be.true;
        expect(supportedChainId(ChainId.testDOGE)).to.be.true;
        expect(supportedChainId(ChainId.testBTC)).to.be.true;
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
