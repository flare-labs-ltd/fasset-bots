import { expect } from "chai";
import { createAttestationHelper, createBlockChainHelper, createBlockChainIndexerHelper, createBlockChainWalletHelper, createBotConfig, createMccClient, createStateConnectorClient, createWalletClient, RunConfig } from "../../../src/config/BotConfig"
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { requireEnv } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
import { SourceId } from "../../../src/verification/sources/sources"
import { getCoston2AccountsFromEnv } from "../../utils/test-actors";
import { COSTON2_CONTRACTS_JSON, COSTON2_RPC, createTestOrmOptions, createTestRunConfig } from "../../utils/test-bot-config";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chai = require("chai");
// eslint-disable-next-line @typescript-eslint/no-var-requires
chai.use(require("chai-as-promised"));

describe("Bot config tests", async () => {
    let runConfig: RunConfig;
    before(async () => {
        await initWeb3(COSTON2_RPC, getCoston2AccountsFromEnv(), null);
        runConfig = createTestRunConfig(COSTON2_RPC, COSTON2_CONTRACTS_JSON, createTestOrmOptions({ schemaUpdate: 'recreate', dbName: 'fasset-bots-c2.db' }));
    });

    it("Should create bot config", async () => {
        const botConfig = await createBotConfig(runConfig);
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
        const fn = () => {
            return createWalletClient(-200 as SourceId);
         };
         expect(fn).to.throw(Error);
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
        const fn = () => {
            return createMccClient(-200 as SourceId);
         };
         expect(fn).to.throw(Error);
    });

    it("Should create block chain indexer", async () => {
        const algo = createBlockChainIndexerHelper(SourceId.ALGO);
        expect(algo.sourceId).to.eq(SourceId.ALGO);
        const btc = createBlockChainIndexerHelper(SourceId.BTC);
        expect(btc.sourceId).to.eq(SourceId.BTC);
        const doge = createBlockChainIndexerHelper(SourceId.DOGE);
        expect(doge.sourceId).to.eq(SourceId.DOGE);
        const ltc = createBlockChainIndexerHelper(SourceId.LTC);
        expect(ltc.sourceId).to.eq(SourceId.LTC);
        const xrp = createBlockChainIndexerHelper(SourceId.XRP);
        expect(xrp.sourceId).to.eq(SourceId.XRP);
        const fn = () => {
            return createBlockChainIndexerHelper(-200 as SourceId);
         };
         expect(fn).to.throw(Error);
    });

    it("Should create block chain helper", async () => {
        const algo = createBlockChainHelper(SourceId.ALGO);
        expect(algo.walletClient.chainType).to.eq(SourceId.ALGO);
        const btc = createBlockChainHelper(SourceId.BTC);
        expect(btc.walletClient.chainType).to.eq(SourceId.BTC);
        const doge = createBlockChainHelper(SourceId.DOGE);
        expect(doge.walletClient.chainType).to.eq(SourceId.DOGE);
        const ltc = createBlockChainHelper(SourceId.LTC);
        expect(ltc.walletClient.chainType).to.eq(SourceId.LTC);
        const xrp = createBlockChainHelper(SourceId.XRP);
        expect(xrp.walletClient.chainType).to.eq(SourceId.XRP);
        const fn = () => {
            return createBlockChainHelper(-200 as SourceId);
         };
         expect(fn).to.throw(Error);
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
        const fn = () => {
            return createBlockChainWalletHelper(-200 as SourceId, orm.em);
         };
         expect(fn).to.throw(Error);
    });

    it("Should create attestation helper", async () => {
        const algo = await createAttestationHelper(SourceId.ALGO);
        expect(algo.chainId).to.eq(SourceId.ALGO);
        const btc = await createAttestationHelper(SourceId.BTC);
        expect(btc.chainId).to.eq(SourceId.BTC);
        const doge = await createAttestationHelper(SourceId.DOGE);
        expect(doge.chainId).to.eq(SourceId.DOGE);
        const ltc = await createAttestationHelper(SourceId.LTC);
        expect(ltc.chainId).to.eq(SourceId.LTC);
        const xrp = await createAttestationHelper(SourceId.XRP);
        expect(xrp.chainId).to.eq(SourceId.XRP);
        await expect(createAttestationHelper(-200 as SourceId)).to.eventually.be.rejected;
    });

    it("Should create state connector helper", async () => {
        const account = requireEnv('OWNER_ADDRESS');
        const algo = await createStateConnectorClient();
        expect(algo.account).to.eq(account);
        const btc = await createStateConnectorClient();
        expect(btc.account).to.eq(account);
        const doge = await createStateConnectorClient();
        expect(doge.account).to.eq(account);
        const ltc = await createStateConnectorClient();
        expect(ltc.account).to.eq(account);
        const xrp = await createStateConnectorClient();
        expect(xrp.account).to.eq(account);
    });

});