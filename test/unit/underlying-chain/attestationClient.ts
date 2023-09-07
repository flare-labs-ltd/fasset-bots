import { requireEnv, sleep, toBN } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
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
import { createAttestationHelper, createBlockchainWalletHelper } from "../../../src/config/BotConfig";
import { artifacts } from "../../../src/utils/artifacts";
import { BlockchainWalletHelper } from "../../../src/underlying-chain/BlockchainWalletHelper";
import { fundedAddressXRP, fundedPrivateKeyXRP, targetAddressXRP } from "./blockchainWalletHelper";
import { ORM } from "../../../src/config/orm";
import { removeWalletAddressFromDB } from "../../test-utils/test-helpers";
use(chaiAsPromised);

const accountPrivateKey = requireEnv("USER_PRIVATE_KEY");
const sourceId = SourceId.XRP;
const indexerUrl: string = "https://attestation-coston.aflabs.net/verifier/xrp";
const walletUrl: string = "https://s.altnet.rippletest.net:51234";
const ref = "0xac11111111110001000000000000000000000000000000000000000000000001";
const finalizationBlocks: number = 6;

// Working tests but skipped from coverage because they take quite some time.
// Feel free to run them any time separately.
describe.skip("Attestation client unit tests", async () => {
    let attestationHelper: AttestationHelper;
    let walletHelper: BlockchainWalletHelper;
    let orm: ORM;

    before(async () => {
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: "recreate", type: "sqlite" }));
        await initWeb3(COSTON_RPC, [accountPrivateKey], null);
        attestationHelper = await createAttestationHelper(
            sourceId,
            ATTESTATION_PROVIDER_URLS,
            STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS,
            STATE_CONNECTOR_ADDRESS,
            OWNER_ADDRESS,
            indexerUrl,
            finalizationBlocks
        );
        walletHelper = createBlockchainWalletHelper(sourceId, orm.em, walletUrl);
    });

    it("Should return round finalization", async () => {
        const IStateConnector = artifacts.require("IStateConnector");
        const stateConnector = await IStateConnector.at(STATE_CONNECTOR_ADDRESS);
        const lastRound = Number(await stateConnector.lastFinalizedRoundId());
        const finalized = await attestationHelper.roundFinalized(lastRound);
        expect(finalized).to.be.true;
        const round = lastRound * 10;
        const finalized2 = await attestationHelper.roundFinalized(round);
        expect(finalized2).to.be.false;
    });

    it("Should prove confirmed block height existence", async () => {
        const windowSeconds = 100;
        const requestConfirmedBlockHeight = await attestationHelper.proveConfirmedBlockHeightExists(windowSeconds);
        expect(requestConfirmedBlockHeight).to.not.be.null;
    });

    it("Should prove payment proof", async () => {
        await walletHelper.addExistingAccount(fundedAddressXRP, fundedPrivateKeyXRP);
        const transaction = await walletHelper.addTransaction(fundedAddressXRP, targetAddressXRP, 1000000, ref, undefined, true);
        // to make sure transaction is already in indexer
        await sleep(2000);
        // prove payment
        const provePayment = await attestationHelper.provePayment(transaction, fundedAddressXRP, targetAddressXRP);
        expect(provePayment).to.not.be.null;
        await removeWalletAddressFromDB(orm, fundedAddressXRP);
    });

    it("Should prove balance decreasing transaction proof", async () => {
        await walletHelper.addExistingAccount(fundedAddressXRP, fundedPrivateKeyXRP);
        const transaction = await walletHelper.addTransaction(fundedAddressXRP, targetAddressXRP, 2000000, ref, undefined, true);
        // to make sure transaction is already in indexer
        await sleep(3000);
        // prove payment
        const proveBalanceDecreasing = await attestationHelper.proveBalanceDecreasingTransaction(transaction, fundedAddressXRP);
        expect(proveBalanceDecreasing).to.not.be.null;
        await removeWalletAddressFromDB(orm, fundedAddressXRP);
    });

    it("Should prove referenced payment nonexistence", async () => {
        const blockHeight = await attestationHelper.chain.getBlockHeight();
        const block = (await attestationHelper.chain.getBlockAt(blockHeight - 2))!;
        const requestConfirmedBlockHeight = await attestationHelper.proveReferencedPaymentNonexistence(
            fundedAddressXRP,
            ref,
            toBN(2000000),
            block.number - 10,
            block.number,
            block.timestamp
        );
        expect(requestConfirmedBlockHeight).to.not.be.null;
    });
});
