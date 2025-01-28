import { AddressValidity, BalanceDecreasingTransaction, ConfirmedBlockHeightExists, encodeAttestationName, Payment, ReferencedPaymentNonexistence } from "@flarenetwork/state-connector-protocol";
import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { Secrets, dataAccessLayerApiKey, indexerApiKey } from "../../../src/config";
import { createBlockchainIndexerHelper, createFlareDataConnectorClient } from "../../../src/config/BotConfig";
import { ChainId } from "../../../src/underlying-chain/ChainId";
import { FlareDataConnectorClientHelper } from "../../../src/underlying-chain/FlareDataConnectorClientHelper";
import { prefix0x, ZERO_BYTES32 } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
import { DATA_ACCESS_LAYER_URLS, COSTON_RPC, INDEXER_URL_XRP, FDC_HUB_ADDRESS, FDC_VERIFICATION_ADDRESS, TEST_SECRETS, RELAY_ADDRESS, INDEXER_URL_BTC, INDEXER_URL_DOGE } from "../../test-utils/test-bot-config";
import { keccak256 } from "web3-utils";
use(chaiAsPromised);

let flareDataConnectorClient: FlareDataConnectorClientHelper;

describe("testXRP attestation/flare data connector tests", () => {
    const chainId = ChainId.testXRP;
    let secrets: Secrets;
    let roundId: number;
    let account: string;

    before(async () => {
        secrets = await Secrets.load(TEST_SECRETS);
        const accountPrivateKey = secrets.required("user.native.private_key");
        const accounts = await initWeb3(COSTON_RPC, [accountPrivateKey], null);
        account = accounts[0];
        flareDataConnectorClient = await createFlareDataConnectorClient(
            INDEXER_URL_XRP,
            indexerApiKey(secrets, INDEXER_URL_XRP),
            DATA_ACCESS_LAYER_URLS,
            dataAccessLayerApiKey(secrets, DATA_ACCESS_LAYER_URLS),
            FDC_VERIFICATION_ADDRESS,
            FDC_HUB_ADDRESS,
            RELAY_ADDRESS,
            account
        );
        roundId = await flareDataConnectorClient.latestFinalizedRound() - 10;
    });

    it("Should return round is finalized", async () => {
        const isRoundFinalized = await flareDataConnectorClient.roundFinalized(roundId);
        expect(isRoundFinalized).to.be.true;
    });

    it("Should wait for round finalization", async () => {
        await flareDataConnectorClient.waitForRoundFinalization(roundId);
    });

    it("Should return round is not finalized", async () => {
        const round = roundId + 1000000000000;
        const isRoundFinalized = await flareDataConnectorClient.roundFinalized(round);
        expect(isRoundFinalized).to.be.false;
    });

    it("Should submit ConfirmedBlockHeightExists request", async () => {
        const blockChainIndexerClient = createBlockchainIndexerHelper(chainId, INDEXER_URL_XRP, indexerApiKey(secrets, INDEXER_URL_XRP));
        const lastFinalizedBlock = await blockChainIndexerClient.getLastFinalizedBlockNumber();
        const queryWindow = 86400;
        const request: ConfirmedBlockHeightExists.Request = {
            attestationType: ConfirmedBlockHeightExists.TYPE,
            sourceId: chainId.sourceId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: {
                blockNumber: String(lastFinalizedBlock),
                queryWindow: String(queryWindow),
            },
        };
        const resp = await flareDataConnectorClient.submitRequest(request);
        expect(resp!.round).to.be.greaterThan(0);
        expect(resp!.data).is.not.null;
    });

    it.skip("Should submit Payment request", async () => {
        const request: Payment.Request = {
            attestationType: Payment.TYPE,
            sourceId: chainId.sourceId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: {
                transactionId: prefix0x("782DB5E0DF5AACBC2A87A1DF60B073F12B3A51A6B1D083D5D63B07CD19F8EFA8"),
                inUtxo: "0",
                utxo: "0"
            },
        };
        const resp = await flareDataConnectorClient.submitRequest(request);
        expect(resp!.round).to.be.greaterThan(0);
        expect(resp!.data).is.not.null;
    });

    it("Should submit ReferencedPaymentNonexistence request", async () => {
        const blockChainIndexerClient = createBlockchainIndexerHelper(chainId, INDEXER_URL_XRP, indexerApiKey(secrets, INDEXER_URL_XRP));
        const lastFinalizedBlockNo = await blockChainIndexerClient.getLastFinalizedBlockNumber();
        const lastFinalizedBlock = await blockChainIndexerClient.getBlockAt(lastFinalizedBlockNo);
        const request: ReferencedPaymentNonexistence.Request = {
            attestationType: ReferencedPaymentNonexistence.TYPE,
            sourceId: chainId.sourceId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: {
                standardPaymentReference: "0x464250526641000100000000000000000000000000000000000000000000b35c",
                amount: "1000",
                checkSourceAddresses: false,
                sourceAddressesRoot: ZERO_BYTES32,
                destinationAddressHash: keccak256("123"),
                minimalBlockNumber: String(lastFinalizedBlock!.number - 1000),
                deadlineBlockNumber: String(lastFinalizedBlock!.number - 1),
                deadlineTimestamp: String(lastFinalizedBlock!.timestamp - 1),
            },
        };
        const resp = await flareDataConnectorClient.submitRequest(request);
        expect(resp!.round).to.be.greaterThan(0);
        expect(resp!.data).is.not.null;
    });

    it.skip("Should submit BalanceDecreasingTransaction request", async () => {
        const request: BalanceDecreasingTransaction.Request = {
            attestationType: BalanceDecreasingTransaction.TYPE,
            sourceId: chainId.sourceId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: {
                transactionId: prefix0x("523B3A4AD40C36DF2C03E75DAAFC95C21DF287A6608AEA648B1B764EE53CD57C"),
                sourceAddressIndicator: keccak256("rPThYRTdgpUDmRBiy2BPDb5F4XZgUkEFeS"),
            },
        };
        const resp = await flareDataConnectorClient.submitRequest(request);
        expect(resp!.round).to.be.greaterThan(0);
        expect(resp!.data).is.not.null;
    });

    it("Should submit AddressValidity request", async () => {
        const request: AddressValidity.Request = {
            attestationType: AddressValidity.TYPE,
            sourceId: chainId.sourceId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: {
                addressStr: "rPThYRTdgpUDmRBiy2BPDb5F4XZgUkEFeS"
            },
        };
        const resp = await flareDataConnectorClient.submitRequest(request);
        expect(resp!.round).to.be.greaterThan(0);
        expect(resp!.data).is.not.null;
    });
});

describe("testBTC attestation/flare data connector tests", () => {
    const chainId = ChainId.testBTC;
    let secrets: Secrets;
    const roundId = 802134;
    let account: string;

    before(async () => {
        secrets = await Secrets.load(TEST_SECRETS);
        const accountPrivateKey = secrets.required("user.native.private_key");
        const accounts = await initWeb3(COSTON_RPC, [accountPrivateKey], null);
        account = accounts[0];
        flareDataConnectorClient = await createFlareDataConnectorClient(
            INDEXER_URL_BTC,
            indexerApiKey(secrets, INDEXER_URL_BTC),
            DATA_ACCESS_LAYER_URLS,
            dataAccessLayerApiKey(secrets, DATA_ACCESS_LAYER_URLS),
            FDC_VERIFICATION_ADDRESS,
            FDC_HUB_ADDRESS,
            RELAY_ADDRESS,
            account
        );
    });

    it("Should submit ConfirmedBlockHeightExists request", async () => {
        const blockChainIndexerClient = createBlockchainIndexerHelper(chainId, INDEXER_URL_BTC, indexerApiKey(secrets, INDEXER_URL_BTC));
        const lastFinalizedBlock = await blockChainIndexerClient.getLastFinalizedBlockNumber();
        const queryWindow = 86400;
        const request: ConfirmedBlockHeightExists.Request = {
            attestationType: ConfirmedBlockHeightExists.TYPE,
            sourceId: chainId.sourceId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: {
                blockNumber: String(lastFinalizedBlock - 10),
                queryWindow: String(queryWindow),
            },
        };
        const resp = await flareDataConnectorClient.submitRequest(request);
        expect(resp!.round).to.be.greaterThan(0);
        expect(resp!.data).is.not.null;
    });

    it.skip("Should submit Payment request", async () => {
        const request: Payment.Request = {
            attestationType: Payment.TYPE,
            sourceId: chainId.sourceId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: {
                transactionId: prefix0x("0ab9e18757f37afb6f3ac622c7893578c97887930dcfb12fa78e933d718fa909"),
                inUtxo: "0",
                utxo: "0"
            },
        };
        const resp = await flareDataConnectorClient.submitRequest(request);
        expect(resp!.round).to.be.greaterThan(0);
        expect(resp!.data).is.not.null;
    });

    it("Should submit ReferencedPaymentNonexistence request", async () => {
        const blockChainIndexerClient = createBlockchainIndexerHelper(chainId, INDEXER_URL_BTC, indexerApiKey(secrets, INDEXER_URL_BTC));
        const lastFinalizedBlockNo = await blockChainIndexerClient.getLastFinalizedBlockNumber();
        const lastFinalizedBlock = await blockChainIndexerClient.getBlockAt(lastFinalizedBlockNo);
        const request: ReferencedPaymentNonexistence.Request = {
            attestationType: ReferencedPaymentNonexistence.TYPE,
            sourceId: chainId.sourceId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: {
                standardPaymentReference: "0x464250526641000100000000000000000000000000000000000000000000b35c",
                amount: "1000",
                checkSourceAddresses: false,
                sourceAddressesRoot: ZERO_BYTES32,
                destinationAddressHash: keccak256("123"),
                minimalBlockNumber: String(lastFinalizedBlock!.number - 100),
                deadlineBlockNumber: String(lastFinalizedBlock!.number - 1),
                deadlineTimestamp: String(lastFinalizedBlock!.timestamp - 1),
            },
        };
        const resp = await flareDataConnectorClient.submitRequest(request);
        expect(resp!.round).to.be.greaterThan(0);
        expect(resp!.data).is.not.null;
    });

    it.skip("Should submit BalanceDecreasingTransaction request", async () => {
        const request: BalanceDecreasingTransaction.Request = {
            attestationType: BalanceDecreasingTransaction.TYPE,
            sourceId: chainId.sourceId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: {
                transactionId: prefix0x("0ab9e18757f37afb6f3ac622c7893578c97887930dcfb12fa78e933d718fa909"),
                sourceAddressIndicator: keccak256("tb1ql8yj58ga4xwq34uuux8nxel6m5dtchml3m7sg4"),
            },
        };
        const resp = await flareDataConnectorClient.submitRequest(request);
        expect(resp!.round).to.be.greaterThan(0);
        expect(resp!.data).is.not.null;
    });

    it("Should submit AddressValidity request", async () => {
        const request: AddressValidity.Request = {
            attestationType: AddressValidity.TYPE,
            sourceId: chainId.sourceId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: {
                addressStr: "tb1ql8yj58ga4xwq34uuux8nxel6m5dtchml3m7sg4"
            },
        };
        const resp = await flareDataConnectorClient.submitRequest(request);
        expect(resp!.round).to.be.greaterThan(0);
        expect(resp!.data).is.not.null;
    });
});

describe("testDOGE attestation/flare data connector tests", () => {
    const chainId = ChainId.testDOGE;
    let secrets: Secrets;
    let account: string;

    before(async () => {
        secrets = await Secrets.load(TEST_SECRETS);
        const accountPrivateKey = secrets.required("user.native.private_key");
        const accounts = await initWeb3(COSTON_RPC, [accountPrivateKey], null);
        account = accounts[0];
        flareDataConnectorClient = await createFlareDataConnectorClient(
            INDEXER_URL_DOGE,
            indexerApiKey(secrets, INDEXER_URL_DOGE),
            DATA_ACCESS_LAYER_URLS,
            dataAccessLayerApiKey(secrets, DATA_ACCESS_LAYER_URLS),
            FDC_VERIFICATION_ADDRESS,
            FDC_HUB_ADDRESS,
            RELAY_ADDRESS,
            account
        );
    });

    it("Should submit ConfirmedBlockHeightExists request", async () => {
        const blockChainIndexerClient = createBlockchainIndexerHelper(chainId, INDEXER_URL_DOGE, indexerApiKey(secrets, INDEXER_URL_DOGE));
        const lastFinalizedBlock = await blockChainIndexerClient.getLastFinalizedBlockNumber();
        const queryWindow = 86400;
        const request: ConfirmedBlockHeightExists.Request = {
            attestationType: ConfirmedBlockHeightExists.TYPE,
            sourceId: chainId.sourceId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: {
                blockNumber: String(lastFinalizedBlock),
                queryWindow: String(queryWindow),
            },
        };
        const resp = await flareDataConnectorClient.submitRequest(request);
        expect(resp!.round).to.be.greaterThan(0);
        expect(resp!.data).is.not.null;
    });

    it.skip("Should submit Payment request", async () => {
        const request: Payment.Request = {
            attestationType: Payment.TYPE,
            sourceId: chainId.sourceId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: {
                transactionId: prefix0x("3b3ad6c157e0e8f58cc4f43982765391d290181808a0f34ff4a03fb44867c7a1"),
                inUtxo: "0",
                utxo: "0"
            },
        };
        const resp = await flareDataConnectorClient.submitRequest(request);
        expect(resp!.round).to.be.greaterThan(0);
        expect(resp!.data).is.not.null;
    });

    it("Should submit ReferencedPaymentNonexistence request", async () => {
        const blockChainIndexerClient = createBlockchainIndexerHelper(chainId, INDEXER_URL_DOGE, indexerApiKey(secrets, INDEXER_URL_DOGE));
        const lastFinalizedBlockNo = await blockChainIndexerClient.getLastFinalizedBlockNumber();
        const lastFinalizedBlock = await blockChainIndexerClient.getBlockAt(lastFinalizedBlockNo);
        const request: ReferencedPaymentNonexistence.Request = {
            attestationType: ReferencedPaymentNonexistence.TYPE,
            sourceId: chainId.sourceId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: {
                standardPaymentReference: "0x464250526641000100000000000000000000000000000000000000000000b35c",
                amount: "1000",
                checkSourceAddresses: false,
                sourceAddressesRoot: ZERO_BYTES32,
                destinationAddressHash: keccak256("123"),
                minimalBlockNumber: String(lastFinalizedBlock!.number - 100),
                deadlineBlockNumber: String(lastFinalizedBlock!.number - 1),
                deadlineTimestamp: String(lastFinalizedBlock!.timestamp - 1),
            },
        };
        const resp = await flareDataConnectorClient.submitRequest(request);
        expect(resp!.round).to.be.greaterThan(0);
        expect(resp!.data).is.not.null;
    });

    it.skip("Should submit BalanceDecreasingTransaction request", async () => {
        const request: BalanceDecreasingTransaction.Request = {
            attestationType: BalanceDecreasingTransaction.TYPE,
            sourceId: chainId.sourceId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: {
                transactionId: prefix0x("3b3ad6c157e0e8f58cc4f43982765391d290181808a0f34ff4a03fb44867c7a1"),
                sourceAddressIndicator: keccak256("njwuugVW6x6PkoBmciJN9djhZh2hmnvSer"),
            },
        };
        const resp = await flareDataConnectorClient.submitRequest(request);
        expect(resp!.round).to.be.greaterThan(0);
        expect(resp!.data).is.not.null;
    });

    it("Should submit AddressValidity request", async () => {
        const request: AddressValidity.Request = {
            attestationType: AddressValidity.TYPE,
            sourceId: chainId.sourceId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: {
                addressStr: "ncqQNzwU9mPvp9dPvaP2AxEyuuKDbzbWHF"
            },
        };
        const resp = await flareDataConnectorClient.submitRequest(request);
        expect(resp!.round).to.be.greaterThan(0);
        expect(resp!.data).is.not.null;
    });
});

describe("Flare data connector tests - decoding", () => {
    const invalidAttestationType = encodeAttestationName("invalid");
    const merkleProof = ["0xa2a603a9acad0bca95be28b9cea549b9b1cbe32519ff1389156b6d3c439535d4"];
    const responsePayment = {
        blockNumber: "0x25101bd",
        blockTimestamp: "0x6493ddf5",
        inUtxo: "0x0",
        intendedReceivedAmount: "0x2540be400",
        intendedReceivingAddressHash: "0xb79cc459808472d8946de9eccb5f3013ab3b6a8dbeb6bee9a07a104a043ed5cc",
        intendedSourceAddressHash: "0x7f5b4967a9fbe9b447fed6d4e3699051516b6afe5f94db2e77ccf86470bfd74d",
        intendedSpentAmount: "0x2540be40c",
        oneToOne: true,
        paymentReference: "0x0000000000000000000000000000000000000000000000000000000000000000",
        receivedAmount: "0x2540be400",
        receivingAddressHash: "0xb79cc459808472d8946de9eccb5f3013ab3b6a8dbeb6bee9a07a104a043ed5cc",
        sourceAddressHash: "0x7f5b4967a9fbe9b447fed6d4e3699051516b6afe5f94db2e77ccf86470bfd74d",
        spentAmount: "0x2540be40c",
        flareDataConnectorRound: 571430,
        status: "0x0",
        transactionHash: "0x7CC280718732FD3354B45B3B1EA2119978469BF89AFA56376A7F9D3EF5B82E29",
        utxo: "0x0",
    };
    const responseBlockHeight = {
        blockNumber: "0x2513459",
        blockTimestamp: "0x64947c32",
        lowestQueryWindowBlockNumber: "0x2513437",
        lowestQueryWindowBlockTimestamp: "0x64947bcd",
        numberOfConfirmations: "0x1",
        flareDataConnectorRound: 571430,
    };
    const responseNonPayment = {
        amount: "0x1404fa27e2c3da0d2990f9f406121a3a",
        deadlineBlockNumber: "0x2515382",
        deadlineTimestamp: "0x6494de5b",
        destinationAddressHash: "0xaa11aee98f1662f468f9398b3aabf155850d90ffb74eb1d7c447c796aea81ba5",
        firstOverflowBlockNumber: "0x2515383",
        firstOverflowBlockTimestamp: "0x6494de5c",
        lowerBoundaryBlockNumber: "0x251531e",
        lowerBoundaryBlockTimestamp: "0x6494dd1a",
        paymentReference: "0xe530837535d367bc130ee181801f91e1a654a054b9b014cf0aeb79ecc7e6d8d2",
        flareDataConnectorRound: 571429,
    };
    const responseBalanceDecreasing = {
        flareDataConnectorRound: 571429,
        blockNumber: "0x2513459",
        blockTimestamp: "0x64947c32",
        transactionHash: "0x7CC280718732FD3354B45B3B1EA2119978469BF89AFA56376A7F9D3EF5B82E29",
        sourceAddressIndicator: "0x7f5b4967a9fbe9b447fed6d4e3699051516b6afe5f94db2e77ccf86470bfd74d",
        sourceAddressHash: "0x7f5b4967a9fbe9b447fed6d4e3699051516b6afe5f94db2e77ccf86470bfd74d",
        spentAmount: "0x2540be40c",
        paymentReference: "0xe530837535d367bc130ee181801f91e1a654a054b9b014cf0aeb79ecc7e6d8d2",
    };
    let flareDataConnectorClientHelper: FlareDataConnectorClientHelper;

    before(async () => {
        const secrets = await Secrets.load(TEST_SECRETS);
        const accountPrivateKey = secrets.required("user.native.private_key");
        const accounts = await initWeb3(COSTON_RPC, [accountPrivateKey], null);
        flareDataConnectorClient = await createFlareDataConnectorClient(
            INDEXER_URL_XRP,
            indexerApiKey(secrets, INDEXER_URL_XRP),
            DATA_ACCESS_LAYER_URLS,
            dataAccessLayerApiKey(secrets, DATA_ACCESS_LAYER_URLS),
            FDC_VERIFICATION_ADDRESS,
            FDC_HUB_ADDRESS,
            RELAY_ADDRESS,
            accounts[0]
        );
        flareDataConnectorClientHelper = new FlareDataConnectorClientHelper(
            DATA_ACCESS_LAYER_URLS,
            DATA_ACCESS_LAYER_URLS.map(url => ""),
            FDC_VERIFICATION_ADDRESS,
            FDC_HUB_ADDRESS,
            RELAY_ADDRESS,
            [""],
            [""],
            accounts[0]
        );
    });

    it("Should not verify proof - invalid attestation type", async () => {
        const proofData: ConfirmedBlockHeightExists.Proof = {
            data: {
                attestationType: invalidAttestationType,
                sourceId: ChainId.testXRP.sourceId,
                lowestUsedTimestamp: "1687489872",
                votingRound: "571512",
                requestBody: {
                    blockNumber: "38888113",
                    queryWindow: "86400",
                },
                responseBody: {
                    blockTimestamp: "1687489980",
                    numberOfConfirmations: "1",
                    lowestQueryWindowBlockNumber: "38888079",
                    lowestQueryWindowBlockTimestamp: "1687489872",
                },
            },
            merkleProof: [
                "0x06132641cdcc7358d02ee84b09c6c005d03b046f5da3cc3f0d02bcbd04fbcbc4",
                "0xcae4c715a94dae234c49acc329915a28ba853435d6f4fb858a5a0a120beac520",
            ],
        };
        await expect((flareDataConnectorClientHelper as any).verifyProof(proofData))
            .to.eventually.be.fulfilled
            .and.be.eq(false);
    });
});
