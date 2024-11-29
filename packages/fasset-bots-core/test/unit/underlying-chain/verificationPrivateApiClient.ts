import { assert } from "chai";
import { ChainId } from "../../../src";
import { indexerApiKey, Secrets } from "../../../src/config";
import { VerificationPrivateApiClient } from "../../../src/underlying-chain/VerificationPrivateApiClient";
import { INDEXER_URL_BTC, INDEXER_URL_DOGE, INDEXER_URL_XRP, TEST_SECRETS } from "../../test-utils/test-bot-config";

describe("VerificationPrivateApiClient tests on XRP", () => {
    let verifier!: VerificationPrivateApiClient;

    before(async () => {
        const secrets = await Secrets.load(TEST_SECRETS);
        const apiKeys = indexerApiKey(secrets, INDEXER_URL_XRP);
        verifier = new VerificationPrivateApiClient(INDEXER_URL_XRP, apiKeys);
    });

    it("should verify address", async () => {
        const res = await verifier.checkAddressValidity(ChainId.testXRP.sourceId, "rLRtws87Njyp6EB7M9jx7sqJNuHyHFpmDf");
        assert.equal(res.isValid, true);
    });

    it("should verify address and find it invalid", async () => {
        const res = await verifier.checkAddressValidity(ChainId.testXRP.sourceId, "rLRtws87Njyp6EB7M9jx7sqJNuHyHFpmDe");
        assert.equal(res.isValid, false);
    });
});

describe("VerificationPrivateApiClient tests on BTC", () => {
    let verifier!: VerificationPrivateApiClient;

    before(async() => {
        const secrets = await Secrets.load(TEST_SECRETS);
        const apiKeys = indexerApiKey(secrets, INDEXER_URL_BTC);
        verifier = new VerificationPrivateApiClient(INDEXER_URL_BTC, apiKeys);
    });

    it("should verify address", async () => {
        const res = await verifier.checkAddressValidity(ChainId.testBTC.sourceId, "tb1qwjw440u8un30ec2jvetudspx5wxrafkq9h444e");
        assert.equal(res.isValid, true);
    });

    it("should verify address and find it invalid", async () => {
        const res = await verifier.checkAddressValidity(ChainId.testBTC.sourceId, "tb1qwjw440u8un30ec2jvetudspx5wxrafkq9h444f");
        assert.equal(res.isValid, false);
    });
});

describe("VerificationPrivateApiClient tests on DOGE", () => {
    let verifier!: VerificationPrivateApiClient;

    before(async () => {
        const secrets = await Secrets.load(TEST_SECRETS);
        const apiKeys = indexerApiKey(secrets, INDEXER_URL_DOGE);
        verifier = new VerificationPrivateApiClient(INDEXER_URL_DOGE, apiKeys);
    });

    it("should verify address", async () => {
        const res = await verifier.checkAddressValidity(ChainId.testDOGE.sourceId, "ncqQNzwU9mPvp9dPvaP2AxEyuuKDbzbWHF");
        assert.equal(res.isValid, true);
    });

    it("should verify address and find it invalid", async () => {
        const res = await verifier.checkAddressValidity(ChainId.testDOGE.sourceId, "ncqQNzwU9mPvp9dPvaP2AxEyuuKDbzbWHx");
        assert.equal(res.isValid, false);
    });
});
