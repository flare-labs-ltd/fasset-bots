import { MCC } from "@flarenetwork/mcc";
import { expect } from "chai";
import { WALLET } from "simple-wallet";
import { ORM } from "../../../src/config/orm";
import { AttestationHelper } from "../../../src/underlying-chain/AttestationHelper";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { BlockChainWalletHelper } from "../../../src/underlying-chain/BlockChainWalletHelper";
import { StateConnectorClientHelper } from "../../../src/underlying-chain/StateConnectorClientHelper";
import { artifacts } from "../../../src/utils/artifacts";
import { requireEnv, sleep, toBN } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
import { SourceId } from "../../../src/verification/sources/sources";
import { createTestOrm } from "../../test.mikro-orm.config";

let blockChainHelper: BlockChainHelper;
let mccClient: MCC.XRP;
let walletClient: WALLET.XRP;
let attestationHelper: AttestationHelper;
let walletHelper: BlockChainWalletHelper;
let orm: ORM;

const XRPWalletConnectionTest = {
    url: process.env.XRP_URL_TESTNET_WALLET || "",
    username: "",
    password: "",
    inTestnet: true
};

const XRPMccConnectionTest = {
    url: process.env.XRP_URL_TESTNET_MCC || "",
    username: "",
    password: "",
    inTestnet: true
};

let stateConnectorClient: StateConnectorClientHelper;
const attestationUrl: string = requireEnv('COSTON2_ATTESTER_BASE_URL');
const costonRPCUrl: string = requireEnv('COSTON2_RPC_URL');
const attestationClientAddress: string = requireEnv('COSTON2_ATTESTATION_CLIENT_ADDRESS');
const stateConnectorAddress: string = requireEnv('COSTON2_STATE_CONNECTOR_ADDRESS');
const account = requireEnv('COSTON2_ACCOUNT');
const accountPrivateKey = requireEnv('COSTON2_ACCOUNT_PRIVATE_KEY');

const fundedAddress = "rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8";
const targetAddress = "r4CrUeY9zcd4TpndxU5Qw9pVXfobAXFWqq";
const amountToSendXRP = 10;
const sourceId = SourceId.XRP;

describe("XRP attestation/state connector tests", async () => {
    before(async () => {
        //assume that fundedAddress, fundedPrivateKey, targetAddress and targetPrivateKey are stored in fasset-bots.db (running test/unit/[chain]/wallet.ts test should do the job)
        await initWeb3(costonRPCUrl, [accountPrivateKey], null);
        stateConnectorClient = await StateConnectorClientHelper.create(artifacts, attestationUrl, attestationClientAddress, stateConnectorAddress, account);
        walletClient = new WALLET.XRP(XRPWalletConnectionTest);
        mccClient = new MCC.XRP(XRPMccConnectionTest);
        blockChainHelper = new BlockChainHelper(walletClient, mccClient);
        attestationHelper = new AttestationHelper(stateConnectorClient, blockChainHelper, sourceId);
        orm = await createTestOrm();
        walletHelper = new BlockChainWalletHelper(walletClient, orm.em, blockChainHelper);
    })
    //PAYMENT
    it("Should create payment, send request for payment proof to attestations and retrieve proof from state connector", async () => {
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendXRP, "TestPayment", undefined, true);
        const requestPayment = await attestationHelper.requestPaymentProof(transaction, fundedAddress, targetAddress);
        await stateConnectorClient.waitForRoundFinalization(requestPayment.round);
        const proof = await stateConnectorClient.obtainProof(requestPayment.round, requestPayment.data);
        expect(proof.finalized).to.be.true;
        expect(proof.result).to.not.be.null;
    });
    //BALANCE DECREASING TRANSACTION
    it("Should create payment, send request to attestations for balance decreasing transaction proof and retrieve proof from state connector", async () => {
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendXRP, "TestDecreasingTransaction", undefined, true);
        const requestBalanceDecreasingTransaction = await attestationHelper.requestBalanceDecreasingTransactionProof(transaction, fundedAddress);
        await stateConnectorClient.waitForRoundFinalization(requestBalanceDecreasingTransaction.round);
        const proof = await stateConnectorClient.obtainProof(requestBalanceDecreasingTransaction.round, requestBalanceDecreasingTransaction.data);
        expect(proof.finalized).to.be.true;
        expect(proof.result).to.not.be.null;
    });
    //CONFIRMED BLOCK HEIGHT
    it("Should retrieve block height, send request for confirmed block height existence to attestations and retrieve proof from state connector", async () => {
        const requestConfirmedBlockHeight = await attestationHelper.requestConfirmedBlockHeightExistsProof();
        await stateConnectorClient.waitForRoundFinalization(requestConfirmedBlockHeight.round);
        const proof = await stateConnectorClient.obtainProof(requestConfirmedBlockHeight.round, requestConfirmedBlockHeight.data);
        expect(proof.finalized).to.be.true;
        expect(proof.result).to.not.be.null;
    });
    //REFERENCED PAYMENT NONEXISTENCE
    it("Should create payment, send request to attestations for referenced payment nonexistence proof and retrieve proof from state connector", async () => {
        const transactionHash = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendXRP, "TestPaymentNonExistence", undefined, true);
        const transactionBlock = await blockChainHelper.getTransactionBlock(transactionHash);
        const transaction = await blockChainHelper.getTransaction(transactionHash);
        await sleep(10000);
        const upperBoundBlock = await blockChainHelper.getBlockAt(transactionBlock!.number + 1);
        if (upperBoundBlock && transaction) {
            const requestPaymentNonexistence = await attestationHelper.requestReferencedPaymentNonexistenceProof(targetAddress, transaction.reference || '', toBN(amountToSendXRP), upperBoundBlock.number, upperBoundBlock.timestamp);
            await stateConnectorClient.waitForRoundFinalization(requestPaymentNonexistence.round);
            const proof = await stateConnectorClient.obtainProof(requestPaymentNonexistence.round, requestPaymentNonexistence.data);
            expect(proof.finalized).to.be.true;
            expect(proof.result).to.not.be.null;
        }

    });

});
