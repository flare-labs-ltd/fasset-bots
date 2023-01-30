import { expect } from "chai";
import { ORM } from "../../../src/config/orm";
import { AttestationHelper } from "../../../src/underlying-chain/AttestationHelper";
import { BlockChainWalletHelper } from "../../../src/underlying-chain/BlockChainWalletHelper";
import { StateConnectorClientHelper } from "../../../src/underlying-chain/StateConnectorClientHelper";
import { requireEnv } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
import { SourceId } from "../../../src/verification/sources/sources";
import { createTestOrm } from "../../test.mikro-orm.config";
import { createTestAttestationHelper, createTestBlockChainWalletHelper, createTestStateConnectorClient } from "../../utils/test-bot-config";

let attestationHelper: AttestationHelper;
let walletHelper: BlockChainWalletHelper;
let orm: ORM;

let stateConnectorClient: StateConnectorClientHelper;
const costonRPCUrl: string = requireEnv('COSTON2_RPC_URL');
const accountPrivateKey = requireEnv('OWNER_PRIVATE_KEY');

const fundedAddress = "T6WVPM7WLGP3DIBWNN3LJGCUNMFRR67BVV5KNS3VJ5HSEAQ3QKTGY5ZKWM";
const targetAddress = "O2GT7KTTT7ESYYR6CJ23QQHXCVNV5W3MGYOYA2MGBPND5MB2BOPGVKFTLE";
const amountToSendALGO = 1;
const sourceId = SourceId.ALGO;

describe("ALGO attestation/state connector tests", async () => {
    before(async () => {
        //assume that fundedAddress, fundedPrivateKey, targetAddress and targetPrivateKey are stored in fasset-bots.db (running test/unit/[chain]/wallet.ts test should do the job)
        await initWeb3(costonRPCUrl, [accountPrivateKey], null);
        stateConnectorClient = await createTestStateConnectorClient();
        attestationHelper = await createTestAttestationHelper(sourceId);
        orm = await createTestOrm({ schemaUpdate: 'recreate' });
        walletHelper = createTestBlockChainWalletHelper(sourceId, orm.em);
    })
    //PAYMENT
    it("Should create payment, send request for payment proof to attestations and retrieve proof from state connector", async () => {
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendALGO, "TestPayment", undefined, true);
        const requestPayment = await attestationHelper.requestPaymentProof(transaction, fundedAddress, targetAddress);
        await stateConnectorClient.waitForRoundFinalization(requestPayment.round);
        const proof = await stateConnectorClient.obtainProof(requestPayment.round, requestPayment.data);
        expect(proof.finalized).to.be.true;
        expect(proof.result).to.not.be.null;
    });
    //BALANCE DECREASING TRANSACTION
    it("Should create payment, send request to attestations for balance decreasing transaction proof and retrieve proof from state connector", async () => {
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendALGO, "TestDecreasingTransaction", undefined, true);
        const requestBalanceDecreasingTransaction = await attestationHelper.requestBalanceDecreasingTransactionProof(transaction, fundedAddress);
        await stateConnectorClient.waitForRoundFinalization(requestBalanceDecreasingTransaction.round);
        const proof = await stateConnectorClient.obtainProof(requestBalanceDecreasingTransaction.round, requestBalanceDecreasingTransaction.data);
        expect(proof.finalized).to.be.true;
        expect(proof.result).to.not.be.null;
    });
    //CONFIRMED BLOCK HEIGHT
    it("Should retrieve block height, send request for confirmed block height existence to attestations and retrieve proof from state connector", async () => {
        const requestConfirmedBlockHeight = await attestationHelper.requestConfirmedBlockHeightExistsProof();
        console.log(requestConfirmedBlockHeight)
        await stateConnectorClient.waitForRoundFinalization(requestConfirmedBlockHeight.round);
        const proof = await stateConnectorClient.obtainProof(requestConfirmedBlockHeight.round, requestConfirmedBlockHeight.data);
        expect(proof.finalized).to.be.true;
        expect(proof.result).to.not.be.null;
    });
    //REFERENCED PAYMENT NONEXISTENCE
    it.skip("Should create payment, send request to attestations for referenced payment nonexistence proof and retrieve proof from state connector", async () => {
        //TODO
    });

});
