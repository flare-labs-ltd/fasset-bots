import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { createBlockchainIndexerHelper, createStateConnectorClient } from "../../../src/config/BotConfig";
import { StateConnectorClientHelper } from "../../../src/underlying-chain/StateConnectorClientHelper";
import { ZERO_BYTES32, requireEnv, toBN } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
import { SourceId } from "../../../src/verification/sources/sources";
import rewire from "rewire";
use(chaiAsPromised);
import { AttestationType } from "../../../src/verification/generated/attestation-types-enum";
import { ARConfirmedBlockHeightExists } from "../../../src/verification/generated/attestation-request-types";
import { testChainInfo } from "../../test-utils/TestChainInfo";
const rewiredStateConnectorClientHelper = rewire("../../../src/underlying-chain/StateConnectorClientHelper");
const rewiredStateConnectorClientHelperClass = rewiredStateConnectorClientHelper.__get__("StateConnectorClientHelper");

let stateConnectorClient: StateConnectorClientHelper;
const costonRPCUrl: string = requireEnv('RPC_URL');
const accountPrivateKey = requireEnv('OWNER_PRIVATE_KEY');

const attestationProviderUrls: string[] = requireEnv('ATTESTER_BASE_URLS').split(",");
const attestationClientAddress: string = requireEnv('ATTESTATION_CLIENT_ADDRESS');
const stateConnectorAddress: string = requireEnv('STATE_CONNECTOR_ADDRESS');
const ownerAddress: string = requireEnv('OWNER_ADDRESS');

const roundIdC2 = 431016;//571512;
const requestDataBytesC2_1 = "0x000100000003e309bade9e0ef87e3e0a1a8c2f0ebb26af4ef9df6b8d3467ca1f4deac171d2b0be2534c86cf42560074c26f346345b96f3e9d8cfd2bac611bc199def83ac5a3c02515d930000";
const requestDataBytesC2_2 = "";
const requestDataBytesC2_3 = "0x0003000000035cfd3a2b8acfa3685043c18aed1bc1c3c3a8fb19e350df38526ec11345c8e20e025162b100000064";
const requestDataBytesC2_4 = "0x00040000000393ae948c1819fa43b86545320c9d7a6b6b49bd8b9b58cc4e68410c856ae9a86602515bd302515c376494f98aa46380794889e4f65f8c19b6aaee2645c07633bb61f8e2ca08d93f056c6710b15a2cc94a7a6901817c2a0abe99ad73a82c4fa247f84b676d5deedaf23ee15c2f2d5f5cdd63c9fbddfc5a7ace02705275";
const sourceId = SourceId.XRP;

describe("XRP attestation/state connector tests", async () => {

    before(async () => {
        await initWeb3(costonRPCUrl, [accountPrivateKey], null);
        stateConnectorClient = await createStateConnectorClient(sourceId, attestationProviderUrls, attestationClientAddress, stateConnectorAddress, ownerAddress);
    })

    it("Should return round is finalized", async () => {
        const isRoundFinalized = await stateConnectorClient.roundFinalized(roundIdC2);
        expect(isRoundFinalized).to.be.true;
    });

    it("Should wait for round finalization", async () => {
        await stateConnectorClient.waitForRoundFinalization(roundIdC2);
    });

    it("Should return round is not finalized", async () => {
        const round = roundIdC2 + 1000000000000;
        const isRoundFinalized = await stateConnectorClient.roundFinalized(round);
        expect(isRoundFinalized).to.be.false;
    });

    it("Should submit request", async () => {
        const blockChainIndexerClient = createBlockchainIndexerHelper(sourceId);
        const blockHeight = await blockChainIndexerClient.getBlockHeight();
        const queryWindow = 86400;
        const request: ARConfirmedBlockHeightExists = {
            attestationType: AttestationType.ConfirmedBlockHeightExists,
            sourceId: sourceId,
            blockNumber: blockHeight - testChainInfo.xrp.finalizationBlocks,
            queryWindow: queryWindow,
            messageIntegrityCode: ZERO_BYTES32,
        };
        const resp = await stateConnectorClient.submitRequest(request);
        expect(resp!.round).to.be.greaterThan(0);
        expect(resp!.data).is.not.null;
    });
    // following will pass until results of roundIdC2 are available
    it.skip("Should obtain proof", async () => {
        const proof1 = await stateConnectorClient.obtainProof(roundIdC2, requestDataBytesC2_1);
        expect(proof1.finalized).to.be.true;
        const proof3 = await stateConnectorClient.obtainProof(roundIdC2, requestDataBytesC2_3);
        expect(proof3.finalized).to.be.true;
        const proof4 = await stateConnectorClient.obtainProof(roundIdC2, requestDataBytesC2_4);
        expect(proof4.finalized).to.be.true;
    });

    it("Should convert from timestamp to roundId",async () => {
        const timestamp = 1687489980;
        const roundId = stateConnectorClient.timestampToRoundId(timestamp);
        expect(roundId).to.not.be.null;
        expect(roundId).to.be.gt(0);
    })

});

describe("State connector tests - decoding", async () => {
    const invalidAttestationType = -1;
    let rewiredStateConnectorHelper: typeof rewiredStateConnectorClientHelperClass;
    const merkleProof = ["0xa2a603a9acad0bca95be28b9cea549b9b1cbe32519ff1389156b6d3c439535d4"];
    const responsePayment = {
        "blockNumber": "0x25101bd",
        "blockTimestamp": "0x6493ddf5",
        "inUtxo": "0x0",
        "intendedReceivedAmount": "0x2540be400",
        "intendedReceivingAddressHash": "0xb79cc459808472d8946de9eccb5f3013ab3b6a8dbeb6bee9a07a104a043ed5cc",
        "intendedSourceAddressHash": "0x7f5b4967a9fbe9b447fed6d4e3699051516b6afe5f94db2e77ccf86470bfd74d",
        "intendedSpentAmount": "0x2540be40c",
        "oneToOne": true,
        "paymentReference": "0x0000000000000000000000000000000000000000000000000000000000000000",
        "receivedAmount": "0x2540be400",
        "receivingAddressHash": "0xb79cc459808472d8946de9eccb5f3013ab3b6a8dbeb6bee9a07a104a043ed5cc",
        "sourceAddressHash": "0x7f5b4967a9fbe9b447fed6d4e3699051516b6afe5f94db2e77ccf86470bfd74d",
        "spentAmount": "0x2540be40c",
        "stateConnectorRound": 571430,
        "status": "0x0",
        "transactionHash": "0x7CC280718732FD3354B45B3B1EA2119978469BF89AFA56376A7F9D3EF5B82E29",
        "utxo": "0x0"
    };
    const responseBlockHeight = {
        "blockNumber": "0x2513459",
        "blockTimestamp": "0x64947c32",
        "lowestQueryWindowBlockNumber": "0x2513437",
        "lowestQueryWindowBlockTimestamp": "0x64947bcd",
        "numberOfConfirmations": "0x1",
        "stateConnectorRound": 571430
    };
    const responseNonPayment = {
        "amount": "0x1404fa27e2c3da0d2990f9f406121a3a",
        "deadlineBlockNumber": "0x2515382",
        "deadlineTimestamp": "0x6494de5b",
        "destinationAddressHash": "0xaa11aee98f1662f468f9398b3aabf155850d90ffb74eb1d7c447c796aea81ba5",
        "firstOverflowBlockNumber": "0x2515383",
        "firstOverflowBlockTimestamp": "0x6494de5c",
        "lowerBoundaryBlockNumber": "0x251531e",
        "lowerBoundaryBlockTimestamp": "0x6494dd1a",
        "paymentReference": "0xe530837535d367bc130ee181801f91e1a654a054b9b014cf0aeb79ecc7e6d8d2",
        "stateConnectorRound": 571429
    };
    const responseBalanceDecreasing = {
        "stateConnectorRound": 571429,
        "blockNumber": "0x2513459",
        "blockTimestamp": "0x64947c32",
        "transactionHash": "0x7CC280718732FD3354B45B3B1EA2119978469BF89AFA56376A7F9D3EF5B82E29",
        "sourceAddressIndicator": "0x7f5b4967a9fbe9b447fed6d4e3699051516b6afe5f94db2e77ccf86470bfd74d",
        "sourceAddressHash": "0x7f5b4967a9fbe9b447fed6d4e3699051516b6afe5f94db2e77ccf86470bfd74d",
        "spentAmount": "0x2540be40c",
        "paymentReference": "0xe530837535d367bc130ee181801f91e1a654a054b9b014cf0aeb79ecc7e6d8d2",
    };
    before(async () => {
        await initWeb3(costonRPCUrl, [accountPrivateKey], null);
        stateConnectorClient = await createStateConnectorClient(sourceId, attestationProviderUrls, attestationClientAddress, stateConnectorAddress, ownerAddress);
        rewiredStateConnectorHelper = new rewiredStateConnectorClientHelperClass(attestationProviderUrls, attestationClientAddress, stateConnectorAddress, "", "", ownerAddress);
    })

    it("Should decode proofs - payment", async () => {
        const decoded = rewiredStateConnectorHelper.decodeProof(responsePayment, AttestationType.Payment, merkleProof);
        expect(decoded.stateConnectorRound).to.eq(responsePayment.stateConnectorRound);
        expect(toBN(decoded.blockNumber).eq(toBN(responsePayment.blockNumber))).to.be.true;
        expect(toBN(decoded.blockTimestamp).eq(toBN(responsePayment.blockTimestamp))).to.be.true;
    });

    it("Should decode proofs - block height", async () => {
        const decoded = rewiredStateConnectorHelper.decodeProof(responseBlockHeight, AttestationType.ConfirmedBlockHeightExists, merkleProof);
        expect(decoded.stateConnectorRound).to.eq(responseBlockHeight.stateConnectorRound);
        expect(toBN(decoded.blockNumber).eq(toBN(responseBlockHeight.blockNumber))).to.be.true;
        expect(toBN(decoded.blockTimestamp).eq(toBN(responseBlockHeight.blockTimestamp))).to.be.true;
    });

    it("Should decode proofs - non payment", async () => {
        const decoded = rewiredStateConnectorHelper.decodeProof(responseNonPayment, AttestationType.ReferencedPaymentNonexistence, merkleProof);
        expect(decoded.stateConnectorRound).to.eq(responseNonPayment.stateConnectorRound);
        expect(toBN(decoded.deadlineBlockNumber).eq(toBN(responseNonPayment.deadlineBlockNumber))).to.be.true;
        expect(toBN(decoded.deadlineTimestamp).eq(toBN(responseNonPayment.deadlineTimestamp))).to.be.true;
        expect(toBN(decoded.amount).eq(toBN(responseNonPayment.amount))).to.be.true;
    });

    it("Should decode proofs - decreasing balance", async () => {
        const decoded = rewiredStateConnectorHelper.decodeProof(responseBalanceDecreasing, AttestationType.BalanceDecreasingTransaction, merkleProof);
        expect(decoded.stateConnectorRound).to.eq(responseBalanceDecreasing.stateConnectorRound);
        expect(toBN(decoded.blockNumber).eq(toBN(responseBalanceDecreasing.blockNumber))).to.be.true;
        expect(toBN(decoded.blockTimestamp).eq(toBN(responseBalanceDecreasing.blockTimestamp))).to.be.true;
        expect(toBN(decoded.spentAmount).eq(toBN(responseBalanceDecreasing.spentAmount))).to.be.true;
    });

    it("Should not decode proofs - invalid type", async () => {
        const fn = () => {
            return rewiredStateConnectorHelper.decodeProof(responseBalanceDecreasing, invalidAttestationType as AttestationType, merkleProof);
        };
        expect(fn).to.throw(`Invalid attestation type ${invalidAttestationType}`);
    });

    it("Should check if last client", async () => {
        const all = rewiredStateConnectorHelper.clients.length;
        const isLast = rewiredStateConnectorHelper.lastClient(all - 1);
        const notLast = rewiredStateConnectorHelper.lastClient(all);
        expect(isLast).to.be.true;
        expect(notLast).to.be.false;
    });


    it("Should not verify proof - invalid attestation type", async () => {
        const proofData = {
            stateConnectorRound: '571512',
            merkleProof: [
                '0x06132641cdcc7358d02ee84b09c6c005d03b046f5da3cc3f0d02bcbd04fbcbc4',
                '0xcae4c715a94dae234c49acc329915a28ba853435d6f4fb858a5a0a120beac520'
            ],
            blockNumber: '38888113',
            blockTimestamp: '1687489980',
            numberOfConfirmations: '1',
            lowestQueryWindowBlockNumber: '38888079',
            lowestQueryWindowBlockTimestamp: '1687489872'
        };
        await expect(rewiredStateConnectorHelper.verifyProof(sourceId, invalidAttestationType, proofData)).to.eventually.be.rejectedWith(`Invalid attestation type ${invalidAttestationType}`).and.be.an.instanceOf(Error);
    });


});