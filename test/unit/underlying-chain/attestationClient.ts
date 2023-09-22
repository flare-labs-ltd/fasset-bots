import { requireEnv, sleep, toBN } from "../../../src/utils/helpers";
import { artifacts, initWeb3 } from "../../../src/utils/web3";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import {
    ATTESTATION_PROVIDER_URLS,
    COSTON_RPC,
    OWNER_ADDRESS,
    STATE_CONNECTOR_ADDRESS,
    STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
    createTestOrmOptions,
} from "../../test-utils/test-bot-config";
import { AttestationHelper } from "../../../src/underlying-chain/AttestationHelper";
import { SourceId } from "../../../src/verification/sources/sources";
import { createAttestationHelper, createBlockchainIndexerHelper, createBlockchainWalletHelper } from "../../../src/config/BotConfig";
import { BlockchainWalletHelper } from "../../../src/underlying-chain/BlockchainWalletHelper";
import { fundedAddressXRP, fundedPrivateKeyXRP, targetAddressXRP } from "./blockchainWalletHelper";
import { ORM } from "../../../src/config/orm";
import { removeWalletAddressFromDB } from "../../test-utils/test-helpers";
import { DBWalletKeys } from "../../../src/underlying-chain/WalletKeys";
import { BlockchainIndexerHelper } from "../../../src/underlying-chain/BlockchainIndexerHelper";
use(chaiAsPromised);

const accountPrivateKey = requireEnv("USER_PRIVATE_KEY");
const sourceId = SourceId.XRP;
const indexerUrl: string = "https://attestation-coston.aflabs.net/verifier/xrp";
const walletUrl: string = "https://s.altnet.rippletest.net:51234";
const ref = "0xac11111111110001000000000000000000000000000000000000000000000001";
const finalizationBlocks: number = 6;

// Working tests but skipped from coverage because they take quite some time.
// Feel free to run them any time separately.
describe("Attestation client unit tests", async () => {
    let attestationHelper: AttestationHelper;
    let walletHelper: BlockchainWalletHelper;
    let orm: ORM;
    let blockChainIndexerClient: BlockchainIndexerHelper;
    let dbWallet: DBWalletKeys;

    before(async () => {
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: "recreate", type: "sqlite" }));
        const accounts = await initWeb3(COSTON_RPC, [accountPrivateKey], null);
        attestationHelper = await createAttestationHelper(
            sourceId,
            ATTESTATION_PROVIDER_URLS,
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            accounts[0],
            indexerUrl,
            finalizationBlocks
        );
        dbWallet = new DBWalletKeys(orm.em);
        walletHelper = createBlockchainWalletHelper(sourceId, orm.em, walletUrl);
        blockChainIndexerClient = createBlockchainIndexerHelper(sourceId, indexerUrl, finalizationBlocks);
    });

    it("Should not obtain proofs - no attestation providers", async () => {
        const localAttestationHelper = await createAttestationHelper(
            sourceId,
            [],
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            OWNER_ADDRESS,
            indexerUrl,
            finalizationBlocks
        );
        await expect(localAttestationHelper.stateConnector.obtainProof(1, "requestData"))
            .to.eventually.be.rejectedWith(`There aren't any attestation providers.`)
            .and.be.an.instanceOf(Error);
    });

    it("Should obtain proofs", async () => {
        // request confirmed block height
        const windowSeconds = 100;
        const requestBlock = await attestationHelper.requestConfirmedBlockHeightExistsProof(windowSeconds);
        // obtain to soon
        const res1 = await attestationHelper.stateConnector.obtainProof(requestBlock!.round, requestBlock!.data);
        expect(res1.finalized).to.be.false;
        // request payment
        await walletHelper.addExistingAccount(fundedAddressXRP, fundedPrivateKeyXRP);
        const transaction = await walletHelper.addTransaction(fundedAddressXRP, targetAddressXRP, 1000000, ref, undefined, true);
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
        // const blockHeight = await attestationHelper.chain.getBlockHeight();
        const blockId = (await attestationHelper.chain.getTransactionBlock(transaction))!;
        const block = (await attestationHelper.chain.getBlockAt(blockId.number))!;
        const requestNonPayment = await attestationHelper.requestReferencedPaymentNonexistenceProof(
            fundedAddressXRP,
            ref,
            toBN(2000000),
            block.number - 10,
            block.number,
            block.timestamp
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
        expect(proofBlock.finalized).to.be.true;
        expect(proofPayment.finalized).to.be.true;
        expect(proofDecreasing.finalized).to.be.true;
        expect(proofNonPayment.finalized).to.be.true;

        const proofBlock1 = await attestationHelper.stateConnector.obtainProof(requestBlock!.round - 2, requestBlock!.data);
        expect(proofBlock1.finalized).to.be.true;
        expect(proofBlock1.result).to.be.null;
    });
});
