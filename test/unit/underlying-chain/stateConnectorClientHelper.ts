import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { createBlockchainIndexerHelper, createStateConnectorClient } from "../../../src/config/BotConfig";
import { StateConnectorClientHelper } from "../../../src/underlying-chain/StateConnectorClientHelper";
import { ZERO_BYTES32 } from "../../../src/utils/helpers";
import { requireSecret } from "../../../src/config/secrets";
import { initWeb3 } from "../../../src/utils/web3";
import rewire from "rewire";
use(chaiAsPromised);
import { testChainInfo } from "../../test-utils/TestChainInfo";
import {
    ATTESTATION_PROVIDER_URLS,
    COSTON_RPC,
    INDEXER_URL_XRP,
    STATE_CONNECTOR_ADDRESS,
    STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
} from "../../test-utils/test-bot-config";
import { SourceId } from "../../../src/underlying-chain/SourceId";
import { ConfirmedBlockHeightExists, encodeAttestationName } from "@flarenetwork/state-connector-protocol";
const rewiredStateConnectorClientHelper = rewire("../../../src/underlying-chain/StateConnectorClientHelper");
const rewiredStateConnectorClientHelperClass = rewiredStateConnectorClientHelper.__get__("StateConnectorClientHelper");

let stateConnectorClient: StateConnectorClientHelper;
const accountPrivateKey = requireSecret("user.native_private_key");
const sourceId = SourceId.testXRP;
const finalizationBlocks: number = 6;

describe("XRP attestation/state connector tests", async () => {
    const roundId = 571512;
    let account: string;

    before(async () => {
        const accounts = await initWeb3(COSTON_RPC, [accountPrivateKey], null);
        account = accounts[0];
        stateConnectorClient = await createStateConnectorClient(
            INDEXER_URL_XRP,
            ATTESTATION_PROVIDER_URLS,
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            account
        );
    });

    it("Should return round is finalized", async () => {
        const isRoundFinalized = await stateConnectorClient.roundFinalized(roundId);
        expect(isRoundFinalized).to.be.true;
    });

    it("Should wait for round finalization", async () => {
        await stateConnectorClient.waitForRoundFinalization(roundId);
    });

    it("Should return round is not finalized", async () => {
        const round = roundId + 1000000000000;
        const isRoundFinalized = await stateConnectorClient.roundFinalized(round);
        expect(isRoundFinalized).to.be.false;
    });

    it("Should submit request", async () => {
        const blockChainIndexerClient = createBlockchainIndexerHelper(sourceId, INDEXER_URL_XRP);
        const blockHeight = await blockChainIndexerClient.getBlockHeight();
        const queryWindow = 86400;
        const request: ConfirmedBlockHeightExists.Request = {
            attestationType: ConfirmedBlockHeightExists.TYPE,
            sourceId: sourceId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: {
                blockNumber: String(blockHeight - testChainInfo.xrp.finalizationBlocks),
                queryWindow: String(queryWindow),
            },
        };
        const resp = await stateConnectorClient.submitRequest(request);
        expect(resp!.round).to.be.greaterThan(0);
        expect(resp!.data).is.not.null;
    });

    it("Should convert from timestamp to roundId", async () => {
        const timestamp = 1687489980;
        const roundId = stateConnectorClient.timestampToRoundId(timestamp);
        expect(roundId).to.not.be.null;
        expect(roundId).to.be.gt(0);
    });
});

describe("State connector tests - decoding", async () => {
    const invalidAttestationType = encodeAttestationName("invalid");
    let rewiredStateConnectorHelper: typeof rewiredStateConnectorClientHelperClass;
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
        stateConnectorRound: 571430,
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
        stateConnectorRound: 571430,
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
        stateConnectorRound: 571429,
    };
    const responseBalanceDecreasing = {
        stateConnectorRound: 571429,
        blockNumber: "0x2513459",
        blockTimestamp: "0x64947c32",
        transactionHash: "0x7CC280718732FD3354B45B3B1EA2119978469BF89AFA56376A7F9D3EF5B82E29",
        sourceAddressIndicator: "0x7f5b4967a9fbe9b447fed6d4e3699051516b6afe5f94db2e77ccf86470bfd74d",
        sourceAddressHash: "0x7f5b4967a9fbe9b447fed6d4e3699051516b6afe5f94db2e77ccf86470bfd74d",
        spentAmount: "0x2540be40c",
        paymentReference: "0xe530837535d367bc130ee181801f91e1a654a054b9b014cf0aeb79ecc7e6d8d2",
    };
    before(async () => {
        const accounts = await initWeb3(COSTON_RPC, [accountPrivateKey], null);
        stateConnectorClient = await createStateConnectorClient(
            INDEXER_URL_XRP,
            ATTESTATION_PROVIDER_URLS,
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            accounts[0]
        );
        rewiredStateConnectorHelper = new rewiredStateConnectorClientHelperClass(
            ATTESTATION_PROVIDER_URLS,
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            "",
            "",
            accounts[0]
        );
    });

    it("Should not verify proof - invalid attestation type", async () => {
        const proofData: ConfirmedBlockHeightExists.Proof = {
            data: {
                attestationType: invalidAttestationType,
                sourceId: SourceId.testXRP,
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
        await expect(rewiredStateConnectorHelper.verifyProof(proofData))
            .to.eventually.be.rejectedWith(`Invalid attestation type ${invalidAttestationType}`)
            .and.be.an.instanceOf(Error);
    });
});
