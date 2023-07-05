import { readFileSync } from "fs";
import { createAttestationHelper, createBlockchainIndexerHelper, createBlockchainWalletHelper, createAgentBotConfig, createStateConnectorClient, createWalletClient, AgentBotRunConfig, TrackedStateRunConfig, createTrackedStateConfig, createTrackedStateConfigChain, createAgentBotConfigChain } from "../../../src/config/BotConfig"
import { requireEnv } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
import { SourceId } from "../../../src/verification/sources/sources"
import { getNativeAccountsFromEnv } from "../../test-utils/test-actors";
import { COSTON_RUN_CONFIG_CONTRACTS, COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS } from "../../test-utils/test-bot-config";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);

const ATTESTER_BASE_URLS: string[] = requireEnv('ATTESTER_BASE_URLS').split(",");
const STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS: string = requireEnv('STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS');
const STATE_CONNECTOR_ADDRESS: string = requireEnv('STATE_CONNECTOR_ADDRESS');
const OWNER_ADDRESS: string = requireEnv('OWNER_ADDRESS');
const RPC_URL: string = requireEnv('RPC_URL');

describe("Bot config tests", async () => {
    let runConfig: AgentBotRunConfig;
    let trackedStateRunConfig: TrackedStateRunConfig;
    before(async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_CONTRACTS).toString()) as AgentBotRunConfig;
        trackedStateRunConfig = JSON.parse(readFileSync(COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS).toString()) as TrackedStateRunConfig;
        await initWeb3(RPC_URL, getNativeAccountsFromEnv(), null);
    });

    it("Should create bot config", async () => {
        const botConfig = await createAgentBotConfig(runConfig);
        expect(botConfig.loopDelay).to.eq(runConfig.loopDelay);
        expect(botConfig.contractsJsonFile).to.not.be.null;
        expect(botConfig.orm).to.not.be.null;
    });

    it("Should create tracked state config", async () => {
        const trackedStateConfig = await createTrackedStateConfig(trackedStateRunConfig);
        expect(trackedStateConfig.contractsJsonFile).to.not.be.null;
    });

    it("Should create wallet clients", async () => {
        const algo = createWalletClient(SourceId.ALGO);
        expect(algo.chainType).to.eq(SourceId.ALGO);
        const btc = createWalletClient(SourceId.BTC);
        expect(btc.chainType).to.eq(SourceId.BTC);
        const doge = createWalletClient(SourceId.DOGE);
        expect(doge.chainType).to.eq(SourceId.DOGE);
        const ltc = createWalletClient(SourceId.LTC);
        expect(ltc.chainType).to.eq(SourceId.LTC);
        const xrp = createWalletClient(SourceId.XRP);
        expect(xrp.chainType).to.eq(SourceId.XRP);
        const invalidSourceId = -200;
        const fn = () => {
            return createWalletClient(invalidSourceId as SourceId);
        };
        expect(fn).to.throw(`SourceId ${invalidSourceId} not supported.`);
    });

    it("Should create block chain indexer", async () => {
        const btc = createBlockchainIndexerHelper(SourceId.BTC);
        expect(btc.sourceId).to.eq(SourceId.BTC);
        const doge = createBlockchainIndexerHelper(SourceId.DOGE);
        expect(doge.sourceId).to.eq(SourceId.DOGE);
        const xrp = createBlockchainIndexerHelper(SourceId.XRP);
        expect(xrp.sourceId).to.eq(SourceId.XRP);
        const sourceId = SourceId.ALGO;
        const fn = () => {
            return createBlockchainIndexerHelper(sourceId);
        };
        expect(fn).to.throw(`SourceId ${sourceId} not supported.`);
    });

    it("Should create block chain wallet helper", async () => {
        const botConfig = await createAgentBotConfig(runConfig);
        const algo = createBlockchainWalletHelper(SourceId.ALGO, botConfig.orm.em);
        expect(algo.walletClient.chainType).to.eq(SourceId.ALGO);
        const btc = createBlockchainWalletHelper(SourceId.BTC, botConfig.orm.em);
        expect(btc.walletClient.chainType).to.eq(SourceId.BTC);
        const doge = createBlockchainWalletHelper(SourceId.DOGE, botConfig.orm.em);
        expect(doge.walletClient.chainType).to.eq(SourceId.DOGE);
        const ltc = createBlockchainWalletHelper(SourceId.LTC, botConfig.orm.em);
        expect(ltc.walletClient.chainType).to.eq(SourceId.LTC);
        const xrp = createBlockchainWalletHelper(SourceId.XRP, botConfig.orm.em);
        expect(xrp.walletClient.chainType).to.eq(SourceId.XRP);
        const invalidSourceId = -200;
        const fn = () => {
            return createBlockchainWalletHelper(invalidSourceId as SourceId, botConfig.orm.em);
        };
        expect(fn).to.throw(`SourceId ${invalidSourceId} not supported.`);
    });

    it("Should create attestation helper", async () => {
        const btc = await createAttestationHelper(SourceId.BTC, ATTESTER_BASE_URLS, STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS, STATE_CONNECTOR_ADDRESS, OWNER_ADDRESS);
        expect(btc.chainId).to.eq(SourceId.BTC);
        const doge = await createAttestationHelper(SourceId.DOGE, ATTESTER_BASE_URLS, STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS, STATE_CONNECTOR_ADDRESS, OWNER_ADDRESS);
        expect(doge.chainId).to.eq(SourceId.DOGE);
        const xrp = await createAttestationHelper(SourceId.XRP, ATTESTER_BASE_URLS, STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS, STATE_CONNECTOR_ADDRESS, OWNER_ADDRESS);
        expect(xrp.chainId).to.eq(SourceId.XRP);
        const unsupportedSourceId = SourceId.ALGO;
        await expect(createAttestationHelper(unsupportedSourceId, ATTESTER_BASE_URLS, STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS, STATE_CONNECTOR_ADDRESS, OWNER_ADDRESS)).to.eventually.be.rejectedWith(`SourceId ${unsupportedSourceId} not supported.`).and.be.an.instanceOf(Error);
    });

    it("Should create state connector helper", async () => {
        const stateConnector = await createStateConnectorClient(SourceId.BTC, ATTESTER_BASE_URLS, STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS, STATE_CONNECTOR_ADDRESS, OWNER_ADDRESS);
        expect(stateConnector.account).to.eq(OWNER_ADDRESS);
        const unsupportedSourceId = SourceId.ALGO;
        await expect(createStateConnectorClient(unsupportedSourceId, ATTESTER_BASE_URLS, STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS, STATE_CONNECTOR_ADDRESS, OWNER_ADDRESS)).to.eventually.be.rejectedWith(`SourceId ${unsupportedSourceId} not supported.`).and.be.an.instanceOf(Error);
    });

    it("Should create tracked state config chain", async () => {
        const chainInfo = trackedStateRunConfig.chainInfos[0];
        const trackedStateConfigChain = await createTrackedStateConfigChain(chainInfo, ATTESTER_BASE_URLS, STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS, STATE_CONNECTOR_ADDRESS, OWNER_ADDRESS);
        expect(trackedStateConfigChain.stateConnector).not.be.null;
    })

    it("Should create agent bot config chain", async () => {
        const botConfig = await createAgentBotConfig(runConfig);
        const chainInfo = runConfig.chainInfos[0];
        const agentBotConfigChain = await createAgentBotConfigChain(chainInfo, botConfig.orm.em, ATTESTER_BASE_URLS, STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS, STATE_CONNECTOR_ADDRESS, OWNER_ADDRESS);
        expect(agentBotConfigChain.stateConnector).not.be.null;
    })

});