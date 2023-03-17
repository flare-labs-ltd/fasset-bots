import { readFileSync } from "fs";
import { createAttestationHelper, createBlockChainHelper, createBlockChainIndexerHelper, createBlockChainWalletHelper, createBotConfig, createMccClient, createStateConnectorClient, createWalletClient, RunConfig } from "../../../src/config/BotConfig"
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { requireEnv } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
import { SourceId } from "../../../src/verification/sources/sources"
import { getCoston2AccountsFromEnv } from "../../test-utils/test-actors";
import { COSTON2_RUN_CONFIG_CONTRACTS } from "../../test-utils/test-bot-config";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);

const ATTESTER_BASE_URLS: string[] = requireEnv('ATTESTER_BASE_URLS').split(",");
const ATTESTATION_CLIENT_ADDRESS: string = requireEnv('ATTESTATION_CLIENT_ADDRESS');
const STATE_CONNECTOR_ADDRESS: string = requireEnv('STATE_CONNECTOR_ADDRESS');
const OWNER_ADDRESS: string = requireEnv('OWNER_ADDRESS');

describe("Bot config tests", async () => {
    let runConfig: RunConfig;
    before(async () => {
        runConfig = JSON.parse(readFileSync(COSTON2_RUN_CONFIG_CONTRACTS).toString()) as RunConfig;
        await initWeb3(runConfig.rpcUrl, getCoston2AccountsFromEnv(), null);
    });

    it("Should create bot config", async () => {
        const botConfig = await createBotConfig(runConfig, OWNER_ADDRESS);
        expect(botConfig.loopDelay).to.eq(runConfig.loopDelay);
        expect(botConfig.contractsJsonFile).to.not.be.null;
        expect(botConfig.stateConnector).to.not.be.null;
        expect(botConfig.orm).to.not.be.null;
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
        const algo = createBlockChainIndexerHelper("", SourceId.ALGO);
        expect(algo.sourceId).to.eq(SourceId.ALGO);
        const btc = createBlockChainIndexerHelper("", SourceId.BTC, true);
        expect(btc.sourceId).to.eq(SourceId.BTC);
        const doge = createBlockChainIndexerHelper("", SourceId.DOGE);
        expect(doge.sourceId).to.eq(SourceId.DOGE);
        const ltc = createBlockChainIndexerHelper("", SourceId.LTC);
        expect(ltc.sourceId).to.eq(SourceId.LTC);
        const xrp = createBlockChainIndexerHelper("", SourceId.XRP);
        expect(xrp.sourceId).to.eq(SourceId.XRP);
        const invalidSourceId = -200;
        const fn = () => {
            return createBlockChainIndexerHelper("", invalidSourceId as SourceId);
        };
        expect(fn).to.throw(`SourceId ${invalidSourceId} not supported.`);
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
        const stateConnector = await createStateConnectorClient(ATTESTER_BASE_URLS, ATTESTATION_CLIENT_ADDRESS, STATE_CONNECTOR_ADDRESS, OWNER_ADDRESS);
        const algo = await createAttestationHelper(SourceId.ALGO, stateConnector);
        expect(algo.chainId).to.eq(SourceId.ALGO);
        const btc = await createAttestationHelper(SourceId.BTC, stateConnector);
        expect(btc.chainId).to.eq(SourceId.BTC);
        const doge = await createAttestationHelper(SourceId.DOGE, stateConnector);
        expect(doge.chainId).to.eq(SourceId.DOGE);
        const ltc = await createAttestationHelper(SourceId.LTC, stateConnector);
        expect(ltc.chainId).to.eq(SourceId.LTC);
        const xrp = await createAttestationHelper(SourceId.XRP, stateConnector);
        expect(xrp.chainId).to.eq(SourceId.XRP);
        const invalidSourceId = -200;
        await expect(createAttestationHelper(invalidSourceId as SourceId, stateConnector)).to.eventually.be.rejectedWith(`SourceId ${invalidSourceId} not supported.`).and.be.an.instanceOf(Error);
    });

    it("Should create state connector helper", async () => {
        const stateConnector = await createStateConnectorClient(ATTESTER_BASE_URLS, ATTESTATION_CLIENT_ADDRESS, STATE_CONNECTOR_ADDRESS, OWNER_ADDRESS);
        expect(stateConnector.account).to.eq(OWNER_ADDRESS);
    });

});