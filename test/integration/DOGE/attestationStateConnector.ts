import { expect } from "chai";
import { createAttestationHelper, createBlockChainWalletHelper, createStateConnectorClient } from "../../../src/config/BotConfig";
import { ORM } from "../../../src/config/orm";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { AttestationHelper } from "../../../src/underlying-chain/AttestationHelper";
import { BlockChainWalletHelper } from "../../../src/underlying-chain/BlockChainWalletHelper";
import { StateConnectorClientHelper } from "../../../src/underlying-chain/StateConnectorClientHelper";
import { requireEnv } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
import { SourceId } from "../../../src/verification/sources/sources";
import { createTestOrmOptions } from "../../test-utils/test-bot-config";

let attestationHelper: AttestationHelper;
let walletHelper: BlockChainWalletHelper;
let orm: ORM;

let stateConnectorClient: StateConnectorClientHelper;
const costonRPCUrl: string = requireEnv('RPC_URL');
const accountPrivateKey = requireEnv('OWNER_PRIVATE_KEY');

const fundedAddress = "nou7f8j829FAEb4SzLz3F1N1CrMAy58ohw";
const targetAddress = "nk1Uc5w6MHC1DgtRvnoQvCj3YgPemzha7D";
const amountToSendDOGE = 1;
const sourceId = SourceId.DOGE;
const attestationProviderUrls: string[] = requireEnv('ATTESTER_BASE_URLS').split(",");
const attestationClientAddress: string = requireEnv('ATTESTATION_CLIENT_ADDRESS');
const stateConnectorAddress: string = requireEnv('STATE_CONNECTOR_ADDRESS');
const ownerAddress: string = requireEnv('OWNER_ADDRESS');

describe("DOGE attestation/state connector tests", async () => {
    before(async () => {
        //assume that fundedAddress, fundedPrivateKey, targetAddress and targetPrivateKey are stored in fasset-bots.db (running test/unit/[chain]/wallet.ts test should do the job)
        await initWeb3(costonRPCUrl, [accountPrivateKey], null);
        stateConnectorClient = await createStateConnectorClient(attestationProviderUrls, attestationClientAddress, stateConnectorAddress, ownerAddress);
        attestationHelper = await createAttestationHelper(sourceId, stateConnectorClient, true);
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
        walletHelper = createBlockChainWalletHelper(sourceId, orm.em, true);
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