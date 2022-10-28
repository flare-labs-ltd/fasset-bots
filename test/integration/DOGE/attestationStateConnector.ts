import { MCC } from "@flarenetwork/mcc";
import { expect } from "chai";
import { WALLET } from "simple-wallet";
import { ORM } from "../../../src/config/orm";
import { AttestationHelper } from "../../../src/underlying-chain/AttestationHelper";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { BlockChainWalletHelper } from "../../../src/underlying-chain/BlockChainWalletHelper";
import { StateConnectorClientHelper } from "../../../src/underlying-chain/StateConnectorClientHelper";
import { artifacts } from "../../../src/utils/artifacts";
import { requireEnv } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
import { SourceId } from "../../../src/verification/sources/sources";
import { createTestOrm } from "../../test.mikro-orm.config";

let blockChainHelper: BlockChainHelper;
let walletClient: WALLET.DOGE;
let mccClient: MCC.DOGE;
let attestationHelper: AttestationHelper;
let walletHelper: BlockChainWalletHelper;
let orm: ORM;

const DOGEWalletConnectionTest = {
    url: process.env.BTC_LTC_DOGE_URL_WALLET || "",
    username: "",
    password: "",
    inTestnet: true
};

const DOGEMccConnectionTest = {
    url: process.env.DOGE_URL_TESTNET_MCC || "",
    username: process.env.DOGE_URL_USER_NAME_TESTNET_MCC || "",
    password: process.env.DOGE_URL_PASSWORD_TESTNET_MCC || "",
    inTestnet: true
};


let stateConnectorClient: StateConnectorClientHelper;
const attestationUrl: string = requireEnv('COSTON2_ATTESTER_BASE_URL');
const costonRPCUrl: string = requireEnv('COSTON2_RPC_URL');
const attestationClientAddress: string = requireEnv('COSTON2_ATTESTATION_CLIENT_ADDRESS');
const stateConnectorAddress: string = requireEnv('COSTON2_STATE_CONNECTOR_ADDRESS');
const account = requireEnv('COSTON2_ACCOUNT');
const accountPrivateKey = requireEnv('COSTON2_ACCOUNT_PRIVATE_KEY');

const fundedAddress = "nou7f8j829FAEb4SzLz3F1N1CrMAy58ohw";
const targetAddress = "nk1Uc5w6MHC1DgtRvnoQvCj3YgPemzha7D";
const amountToSendDOGE = 1;
const sourceId = SourceId.DOGE;

describe("DOGE attestation/state connector tests", async () => {
    before(async () => {
        //assume that fundedAddress, fundedPrivateKey, targetAddress and targetPrivateKey are stored in fasset-bots.db (running test/unit/[chain]/wallet.ts test should do the job)
        await initWeb3(costonRPCUrl, [accountPrivateKey], null);
        stateConnectorClient = await StateConnectorClientHelper.create(artifacts, attestationUrl, attestationClientAddress, stateConnectorAddress, account);
        walletClient = new WALLET.DOGE(DOGEWalletConnectionTest);
        mccClient = new MCC.DOGE(DOGEMccConnectionTest);
        blockChainHelper = new BlockChainHelper(walletClient, mccClient);
        attestationHelper = new AttestationHelper(stateConnectorClient, blockChainHelper, sourceId);
        orm = await createTestOrm();
        walletHelper = new BlockChainWalletHelper(walletClient, orm.em, blockChainHelper);
    })
    //PAYMENT
    it("Should create payment, send request for payment proof to attestations and retrieve proof from state connector", async () => {
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendDOGE, "TestPayment", undefined, true);
        const requestPayment = await attestationHelper.requestPaymentProof(transaction, fundedAddress, targetAddress);
        await stateConnectorClient.waitForRoundFinalization(requestPayment.round);
        const proof = await stateConnectorClient.obtainProof(requestPayment.round, requestPayment.data);
        expect(proof.finalized).to.be.true;
        expect(proof.result).to.not.be.null;
    });
    //BALANCE DECREASING TRANSACTION
    it("Should create payment, send request to attestations for balance decreasing transaction proof and retrieve proof from state connector", async () => {
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendDOGE, "TestDecreasingTransaction", undefined, true);
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
    it.skip("Should create payment, send request to attestations for referenced payment nonexistence proof and retrieve proof from state connector", async () => {
        //TODO
    });

});
