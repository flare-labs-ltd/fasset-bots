import { DHBalanceDecreasingTransaction, DHConfirmedBlockHeightExists, DHPayment, DHReferencedPaymentNonexistence } from "../verification/generated/attestation-hash-types";
import { MockAttestationProverError } from "./MockAttestationProver";
import { MockChain } from "./MockChain";

export class MockAlwaysFailsAttestationProver {
    constructor(
        public chain: MockChain,
        public queryWindowSeconds: number,
    ) { }

    payment(transactionHash: string, transactionBlockNumber: number, inUtxo: number, utxo: number): DHPayment {
        throw new MockAttestationProverError(`AttestationProver.payment: failed`);
    }

    balanceDecreasingTransaction(transactionHash: string, transactionBlockNumber: number, sourceAddressIndicator: string): DHBalanceDecreasingTransaction {
        const method = 'balanceDecreasingTransaction';
        throw new MockAttestationProverError(`AttestationProver.balanceDecreasingTransaction: failed`);
    }

    referencedPaymentNonexistence(destinationAddressHash: string, paymentReference: string, amount: BN, startBlock: number, endBlock: number, endTimestamp: number): DHReferencedPaymentNonexistence {
        throw new MockAttestationProverError(`AttestationProver.referencedPaymentNonexistence: failed`);
    }

    confirmedBlockHeightExists(blockNumber: number, queryWindow: number): DHConfirmedBlockHeightExists {
        throw new MockAttestationProverError(`AttestationProver.confirmedBlockHeightExists: failed`);
    }
}
