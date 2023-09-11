import { readFileSync } from "fs";
import {
    BotConfigFile,
    createAttestationHelper,
    createBlockchainIndexerHelper,
    createBlockchainWalletHelper,
    createBotChainConfig,
    createBotConfig,
    createChainConfig,
    createStateConnectorClient,
    createWalletClient,
} from "../../../src/config/BotConfig";
import { initWeb3 } from "../../../src/utils/web3";
import { SourceId } from "../../../src/verification/sources/sources";
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
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_CONTRACTS).toString()) as BotConfigFile;
        actorRunConfig = JSON.parse(readFileSync(COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS).toString()) as BotConfigFile;
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
        const chainInfo = actorRunConfig.chainInfos[0];
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
        const chainInfo = runConfig.chainInfos[0];
        const agentBotConfigChain = await createBotChainConfig(
            chainInfo,
            botConfig.orm!.em,
            ATTESTATION_PROVIDER_URLS,
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            OWNER_ADDRESS
        );
        expect(agentBotConfigChain.stateConnector).not.be.null;
    });
});
