import {
    BotConfigFile,
    createAttestationHelper,
    createBlockchainIndexerHelper,
    createBlockchainWalletHelper,
    createBotFAssetConfig,
    createBotConfig,
    createChainConfig,
    createStateConnectorClient,
    createWalletClient,
    loadConfigFile,
} from "../../../src/config/BotConfig";
import { initWeb3 } from "../../../src/utils/web3";
import {
    ATTESTATION_PROVIDER_URLS,
    COSTON_RPC,
    COSTON_RUN_CONFIG_CONTRACTS,
    COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS,
    OWNER_ADDRESS,
    STATE_CONNECTOR_ADDRESS,
    STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
} from "../../test-utils/test-bot-config";
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

const indexerBTCUrl = "https://attestation-coston.aflabs.net/verifier/btc/";
const indexerDOGEUrl = "https://attestation-coston.aflabs.net/verifier/doge/";
const indexerXRPUrl = "https://attestation-coston.aflabs.net/verifier/xrp";
const walletBTCUrl = "https://api.bitcore.io/api/BTC/testnet/";
const walletDOGEUrl = "https://api.bitcore.io/api/DOGE/testnet/";
const walletXRPUrl = "https://s.altnet.rippletest.net:51234";

const finalizationBlocks = 0;
describe("Bot config tests", async () => {
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
        expect(botConfig.contractsJsonFile).to.not.be.null;
        expect(botConfig.orm).to.not.be.null;
    });

    it("Should create tracked state config", async () => {
        const trackedStateConfig = await createBotConfig(actorRunConfig, accounts[0]);
        expect(trackedStateConfig.contractsJsonFile).to.not.be.null;
    });

    it("Should create wallet clients", async () => {
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
        const btc = createBlockchainIndexerHelper(SourceId.BTC, indexerBTCUrl, finalizationBlocks);
        expect(btc.sourceId).to.eq(SourceId.BTC);
        const doge = createBlockchainIndexerHelper(SourceId.DOGE, indexerDOGEUrl, finalizationBlocks);
        expect(doge.sourceId).to.eq(SourceId.DOGE);
        const xrp = createBlockchainIndexerHelper(SourceId.XRP, indexerXRPUrl, finalizationBlocks);
        expect(xrp.sourceId).to.eq(SourceId.XRP);
        const sourceId = SourceId.LTC;
        const fn = () => {
            return createBlockchainIndexerHelper(sourceId, "", finalizationBlocks);
        };
        expect(fn).to.throw(`SourceId ${sourceId} not supported.`);
    });

    it("Should create block chain wallet helper", async () => {
        const botConfig = await createBotConfig(runConfig, accounts[0]);
        const btc = createBlockchainWalletHelper(SourceId.BTC, botConfig.orm!.em, walletBTCUrl);
        expect(btc.walletClient.chainType).to.eq(SourceId.BTC);
        const doge = createBlockchainWalletHelper(SourceId.DOGE, botConfig.orm!.em, walletDOGEUrl);
        expect(doge.walletClient.chainType).to.eq(SourceId.DOGE);
        const xrp = createBlockchainWalletHelper(SourceId.XRP, botConfig.orm!.em, walletXRPUrl);
        expect(xrp.walletClient.chainType).to.eq(SourceId.XRP);
        const invalidSourceId = SourceId.ALGO;
        const fn = () => {
            return createBlockchainWalletHelper(invalidSourceId, botConfig.orm!.em, "");
        };
        expect(fn).to.throw(`SourceId ${invalidSourceId} not supported.`);
    });

    it("Should create attestation helper", async () => {
        const btc = await createAttestationHelper(
            SourceId.BTC,
            ATTESTATION_PROVIDER_URLS,
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            OWNER_ADDRESS,
            indexerBTCUrl,
            finalizationBlocks
        );
        expect(btc.chainId).to.eq(SourceId.BTC);
        const doge = await createAttestationHelper(
            SourceId.DOGE,
            ATTESTATION_PROVIDER_URLS,
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            OWNER_ADDRESS,
            indexerDOGEUrl,
            finalizationBlocks
        );
        expect(doge.chainId).to.eq(SourceId.DOGE);
        const xrp = await createAttestationHelper(
            SourceId.XRP,
            ATTESTATION_PROVIDER_URLS,
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            OWNER_ADDRESS,
            indexerXRPUrl,
            finalizationBlocks
        );
        expect(xrp.chainId).to.eq(SourceId.XRP);
        const unsupportedSourceId = SourceId.ALGO;
        await expect(
            createAttestationHelper(
                unsupportedSourceId,
                ATTESTATION_PROVIDER_URLS,
                STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
                STATE_CONNECTOR_ADDRESS,
                OWNER_ADDRESS,
                indexerXRPUrl,
                finalizationBlocks
            )
        )
            .to.eventually.be.rejectedWith(`SourceId ${unsupportedSourceId} not supported.`)
            .and.be.an.instanceOf(Error);
    });

    it("Should create state connector helper", async () => {
        const stateConnector = await createStateConnectorClient(
            indexerXRPUrl,
            ATTESTATION_PROVIDER_URLS,
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            OWNER_ADDRESS
        );
        expect(stateConnector.account).to.eq(OWNER_ADDRESS);
    });

    it("Should create tracked state config chain", async () => {
        const chainInfo = actorRunConfig.fAssetInfos[0];
        const trackedStateConfigChain = await createChainConfig(
            chainInfo,
            ATTESTATION_PROVIDER_URLS,
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            OWNER_ADDRESS
        );
        expect(trackedStateConfigChain.stateConnector).not.be.null;
    });

    it("Should create agent bot config chain", async () => {
        const botConfig = await createBotConfig(runConfig, accounts[0]);
        const chainInfo = runConfig.fAssetInfos[0];
        const agentBotConfigChain = await createBotFAssetConfig(
            chainInfo,
            botConfig.orm!.em,
            ATTESTATION_PROVIDER_URLS,
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            OWNER_ADDRESS
        );
        expect(agentBotConfigChain.stateConnector).not.be.null;
    });

    it("Should not validate config - contractsJsonFile or addressUpdater must be defined", async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_CONTRACTS).toString()) as BotConfigFile;
        runConfig.contractsJsonFile = undefined;
        runConfig.addressUpdater = undefined;
        const fn = () => {
            return validateConfigFile(runConfig);
        };
        expect(fn).to.throw(`Missing either contractsJsonFile or addressUpdater in config`);
    });

    it("Should not validate config - assetManager or fAssetSymbol must be defined", async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_CONTRACTS).toString()) as BotConfigFile;
        runConfig.fAssetInfos[0].assetManager = undefined;
        runConfig.fAssetInfos[0].fAssetSymbol = undefined;
        const fn = () => {
            return validateConfigFile(runConfig);
        };
        expect(fn).to.throw(`Missing either assetManager or fAssetSymbol in FAsset type undefined`);
    });

    it("Should not validate config - walletUrl must be defined", async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_CONTRACTS).toString()) as BotConfigFile;
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
    });
});
