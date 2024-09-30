import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { Secrets, createStateConnectorClient, indexerApiKey, supportedChainId } from "../../../src/config";
import { createBlockchainIndexerHelper, createBlockchainWalletHelper } from "../../../src/config/BotConfig";
import { ORM } from "../../../src/config/orm";
import { AttestationHelper } from "../../../src/underlying-chain/AttestationHelper";
import { BlockchainIndexerHelper } from "../../../src/underlying-chain/BlockchainIndexerHelper";
import { BlockchainWalletHelper } from "../../../src/underlying-chain/BlockchainWalletHelper";
import { ChainId } from "../../../src/underlying-chain/ChainId";
import { DBWalletKeys } from "../../../src/underlying-chain/WalletKeys";
import { AttestationNotProved } from "../../../src/underlying-chain/interfaces/IStateConnectorClient";
import { toBN } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
import { createTestOrm } from "../../test-utils/create-test-orm";
import { ATTESTATION_PROVIDER_URLS, COSTON_RPC, OWNER_ADDRESS, STATE_CONNECTOR_ADDRESS, STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS, TEST_SECRETS } from "../../test-utils/test-bot-config";
import { enableSlowTests, itIf } from "../../test-utils/test-helpers";
import { fundedAddressXRP, fundedPrivateKeyXRP, targetAddressXRP } from "./blockchainWalletHelper";
use(chaiAsPromised);

const chainId = ChainId.testXRP;
const indexerUrl: string = "https://attestation-coston.aflabs.net/verifier/xrp";
const walletUrl: string = "https://s.altnet.rippletest.net:51234";
const ref = "0xac11111111110001000000000000000000000000000000000000000000000001";
const finalizationBlocks: number = 6;

async function createAttestationHelper(
    chainId: ChainId,
    attestationProviderUrls: string[],
    scProofVerifierAddress: string,
    stateConnectorAddress: string,
    owner: string,
    indexerUrl: string,
    indexerApiKey: string,
): Promise<AttestationHelper> {
    if (!supportedChainId(chainId)) {
        throw new Error(`SourceId ${chainId} not supported.`);
    }
    const stateConnector = await createStateConnectorClient(indexerUrl, indexerApiKey, attestationProviderUrls, scProofVerifierAddress, stateConnectorAddress, owner);
    const indexer = createBlockchainIndexerHelper(chainId, indexerUrl, indexerApiKey);
    return new AttestationHelper(stateConnector, indexer, chainId);
}


// Working tests but skipped from coverage because they take quite some time.
// Feel free to run them any time separately.
describe("Attestation client unit tests", () => {
    let secrets: Secrets;
    let attestationHelper: AttestationHelper;
    let walletHelper: BlockchainWalletHelper;
    let orm: ORM;
    let blockChainIndexerClient: BlockchainIndexerHelper;
    let dbWallet: DBWalletKeys;

    before(async () => {
        secrets = Secrets.load(TEST_SECRETS);
        orm = await createTestOrm();
        const accountPrivateKey = secrets.required("owner.native.private_key");
        const accounts = await initWeb3(COSTON_RPC, [accountPrivateKey], null);
        attestationHelper = await createAttestationHelper(
            chainId,
            ATTESTATION_PROVIDER_URLS,
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            accounts[0],
            indexerUrl,
            indexerApiKey(secrets)
        );
        dbWallet = DBWalletKeys.from(orm.em, secrets);
        walletHelper = await createBlockchainWalletHelper(secrets, chainId, orm.em, walletUrl);
        blockChainIndexerClient = createBlockchainIndexerHelper(chainId, indexerUrl, indexerApiKey(secrets));
    });

    it("Should not obtain proofs - no attestation providers", async () => {
        const localAttestationHelper = await createAttestationHelper(
            chainId,
            [],
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            OWNER_ADDRESS,
            indexerUrl,
            indexerApiKey(secrets)
        );
        await expect(localAttestationHelper.stateConnector.obtainProof(1, "requestData"))
            .to.eventually.be.rejectedWith(`There aren't any working attestation providers.`)
            .and.be.an.instanceOf(Error);
    });

    itIf(enableSlowTests())("Should obtain proofs", async () => {
        // request confirmed block height
        const windowSeconds = 100;
        const requestBlock = await attestationHelper.requestConfirmedBlockHeightExistsProof(windowSeconds);
        // obtain to soon
        const res1 = await attestationHelper.stateConnector.obtainProof(requestBlock!.round, requestBlock!.data);
        expect(res1).to.be.equal(AttestationNotProved.NOT_FINALIZED);
        // request payment
        await walletHelper.addExistingAccount(fundedAddressXRP, fundedPrivateKeyXRP);
        const transaction = await walletHelper.addTransactionAndWaitForItsFinalization(fundedAddressXRP, targetAddressXRP, 1000000, ref, undefined);
        await blockChainIndexerClient.waitForUnderlyingTransactionFinalization(transaction);
        let currentBlockHeight = await blockChainIndexerClient.getBlockHeight();
        const finalBlock = currentBlockHeight + finalizationBlocks;
        while (currentBlockHeight <= finalBlock) {
            currentBlockHeight = await blockChainIndexerClient.getBlockHeight();
        }
        const requestPayment = await attestationHelper.requestPaymentProof(transaction, fundedAddressXRP, targetAddressXRP);
        // request balance decreasing
        const requestDecreasing = await attestationHelper.requestBalanceDecreasingTransactionProof(transaction, fundedAddressXRP);
        // request non payment
        const blockId = (await attestationHelper.chain.getTransactionBlock(transaction))!;
        const block = (await attestationHelper.chain.getBlockAt(blockId.number))!;
        const requestNonPayment = await attestationHelper.requestReferencedPaymentNonexistenceProof(
            fundedAddressXRP,
            ref,
            toBN(2000000),
            block.number - 10,
            block.number,
            block.timestamp + 20
        );

        // wait for round finalizations
        await attestationHelper.stateConnector.waitForRoundFinalization(requestBlock!.round);
        await attestationHelper.stateConnector.waitForRoundFinalization(requestPayment!.round);
        await attestationHelper.stateConnector.waitForRoundFinalization(requestDecreasing!.round);
        await attestationHelper.stateConnector.waitForRoundFinalization(requestNonPayment!.round);

        // obtain proofs
        const proofBlock = await attestationHelper.stateConnector.obtainProof(requestBlock!.round, requestBlock!.data);
        const proofPayment = await attestationHelper.stateConnector.obtainProof(requestPayment!.round, requestPayment!.data);
        const proofDecreasing = await attestationHelper.stateConnector.obtainProof(requestDecreasing!.round, requestDecreasing!.data);
        const proofNonPayment = await attestationHelper.stateConnector.obtainProof(requestNonPayment!.round, requestNonPayment!.data);
        expect(proofBlock).to.not.be.equal(AttestationNotProved.NOT_FINALIZED);
        expect(proofPayment).to.not.be.equal(AttestationNotProved.NOT_FINALIZED);
        expect(proofDecreasing).to.not.be.equal(AttestationNotProved.NOT_FINALIZED);
        expect(proofNonPayment).to.not.be.equal(AttestationNotProved.NOT_FINALIZED);

        const proofBlock1 = await attestationHelper.stateConnector.obtainProof(requestBlock!.round - 2, requestBlock!.data);
        expect(proofBlock1).to.be.equal(AttestationNotProved.DISPROVED);
    });
});
