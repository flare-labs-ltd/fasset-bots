import { readFileSync } from "fs";
import { createAttestationHelper, createBlockChainHelper, createBlockChainIndexerHelper, createBlockChainWalletHelper, createAgentBotConfig, createMccClient, createStateConnectorClient, createWalletClient, AgentBotRunConfig, TrackedStateRunConfig, createTrackedStateConfig, createAgentBotDefaultSettings } from "../../../src/config/BotConfig"
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { requireEnv } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
import { SourceId } from "../../../src/verification/sources/sources"
import { getCoston2AccountsFromEnv } from "../../test-utils/test-actors";
import { COSTON2_RUN_CONFIG_CONTRACTS, COSTON2_SIMPLIFIED_RUN_CONFIG_CONTRACTS } from "../../test-utils/test-bot-config";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);

const ATTESTER_BASE_URLS: string[] = requireEnv('ATTESTER_BASE_URLS').split(",");
const ATTESTATION_CLIENT_ADDRESS: string = requireEnv('ATTESTATION_CLIENT_ADDRESS');
const STATE_CONNECTOR_ADDRESS: string = requireEnv('STATE_CONNECTOR_ADDRESS');
const OWNER_ADDRESS: string = requireEnv('OWNER_ADDRESS');
const RPC_URL: string = requireEnv('RPC_URL');

describe("Bot config tests", async () => {
    let runConfig: AgentBotRunConfig;
    let trackedStateRunConfig: TrackedStateRunConfig;
    before(async () => {
        runConfig = JSON.parse(readFileSync(COSTON2_RUN_CONFIG_CONTRACTS).toString()) as AgentBotRunConfig;
        trackedStateRunConfig = JSON.parse(readFileSync(COSTON2_SIMPLIFIED_RUN_CONFIG_CONTRACTS).toString()) as TrackedStateRunConfig;
        await initWeb3(RPC_URL, getCoston2AccountsFromEnv(), null);
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

    it("Should create mcc clients", async () => {
        const algo = createMccClient(SourceId.ALGO);
        expect(algo.chainType).to.eq(SourceId.ALGO);
        const btc = createMccClient(SourceId.BTC);
        expect(btc.chainType).to.eq(SourceId.BTC);
        const doge = createMccClient(SourceId.DOGE);
        expect(doge.chainType).to.eq(SourceId.DOGE);
        const ltc = createMccClient(SourceId.LTC);
        expect(ltc.chainType).to.eq(SourceId.LTC);
        const xrp = createMccClient(SourceId.XRP);
        expect(xrp.chainType).to.eq(SourceId.XRP);
        const invalidSourceId = -200;
        const fn = () => {
            return createMccClient(invalidSourceId as SourceId);
        };
        expect(fn).to.throw(`SourceId ${invalidSourceId} not supported.`);
    });

    it("Should create block chain indexer", async () => {
        const btc = createBlockChainIndexerHelper(SourceId.BTC);
        expect(btc.sourceId).to.eq(SourceId.BTC);
        const doge = createBlockChainIndexerHelper(SourceId.DOGE);
        expect(doge.sourceId).to.eq(SourceId.DOGE);
        const xrp = createBlockChainIndexerHelper(SourceId.XRP);
        expect(xrp.sourceId).to.eq(SourceId.XRP);
        const sourceId = SourceId.ALGO;
        const fn = () => {
            return createBlockChainIndexerHelper(sourceId);
        };
        expect(fn).to.throw(`SourceId ${sourceId} not supported.`);
    });

    it("Should create block chain helper", async () => {
        const algo = createBlockChainHelper(SourceId.ALGO);
        expect(algo.mccClient.chainType).to.eq(SourceId.ALGO);
        const btc = createBlockChainHelper(SourceId.BTC);
        expect(btc.mccClient.chainType).to.eq(SourceId.BTC);
        const doge = createBlockChainHelper(SourceId.DOGE);
        expect(doge.mccClient.chainType).to.eq(SourceId.DOGE);
        const ltc = createBlockChainHelper(SourceId.LTC);
        expect(ltc.mccClient.chainType).to.eq(SourceId.LTC);
        const xrp = createBlockChainHelper(SourceId.XRP);
        expect(xrp.mccClient.chainType).to.eq(SourceId.XRP);
        const invalidSourceId = -200;
        const fn = () => {
            return createBlockChainHelper(invalidSourceId as SourceId);
        };
        expect(fn).to.throw(`SourceId ${invalidSourceId} not supported.`);
    });

    it("Should create block chain wallet helper", async () => {
        const orm = await overrideAndCreateOrm();
        const algo = createBlockChainWalletHelper(SourceId.ALGO, orm.em);
        expect(algo.walletClient.chainType).to.eq(SourceId.ALGO);
        const btc = createBlockChainWalletHelper(SourceId.BTC, orm.em);
        expect(btc.walletClient.chainType).to.eq(SourceId.BTC);
        const doge = createBlockChainWalletHelper(SourceId.DOGE, orm.em);
        expect(doge.walletClient.chainType).to.eq(SourceId.DOGE);
        const ltc = createBlockChainWalletHelper(SourceId.LTC, orm.em);
        expect(ltc.walletClient.chainType).to.eq(SourceId.LTC);
        const xrp = createBlockChainWalletHelper(SourceId.XRP, orm.em);
        expect(xrp.walletClient.chainType).to.eq(SourceId.XRP);
        const invalidSourceId = -200;
        const fn = () => {
            return createBlockChainWalletHelper(invalidSourceId as SourceId, orm.em);
        };
        expect(fn).to.throw(`SourceId ${invalidSourceId} not supported.`);
    });

    it("Should create attestation helper", async () => {
        const btc = await createAttestationHelper(SourceId.BTC, ATTESTER_BASE_URLS, ATTESTATION_CLIENT_ADDRESS, STATE_CONNECTOR_ADDRESS, OWNER_ADDRESS);
        expect(btc.chainId).to.eq(SourceId.BTC);
        const doge = await createAttestationHelper(SourceId.DOGE, ATTESTER_BASE_URLS, ATTESTATION_CLIENT_ADDRESS, STATE_CONNECTOR_ADDRESS, OWNER_ADDRESS);
        expect(doge.chainId).to.eq(SourceId.DOGE);
        const xrp = await createAttestationHelper(SourceId.XRP, ATTESTER_BASE_URLS, ATTESTATION_CLIENT_ADDRESS, STATE_CONNECTOR_ADDRESS, OWNER_ADDRESS);
        expect(xrp.chainId).to.eq(SourceId.XRP);
        const unsupportedSourceId = SourceId.ALGO;
        await expect(createAttestationHelper(SourceId.ALGO, ATTESTER_BASE_URLS, ATTESTATION_CLIENT_ADDRESS, STATE_CONNECTOR_ADDRESS, OWNER_ADDRESS)).to.eventually.be.rejectedWith(`SourceId ${unsupportedSourceId} not supported.`).and.be.an.instanceOf(Error);
    });

    it("Should create state connector helper", async () => {
        const stateConnector = await createStateConnectorClient(SourceId.BTC, ATTESTER_BASE_URLS, ATTESTATION_CLIENT_ADDRESS, STATE_CONNECTOR_ADDRESS, OWNER_ADDRESS);
        expect(stateConnector.account).to.eq(OWNER_ADDRESS);
    });

});