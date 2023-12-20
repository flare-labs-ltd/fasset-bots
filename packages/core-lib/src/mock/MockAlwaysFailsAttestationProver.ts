import { BalanceDecreasingTransaction, ConfirmedBlockHeightExists, Payment, ReferencedPaymentNonexistence } from "@flarenetwork/state-connector-protocol";
import { MockAttestationProverError } from "./MockAttestationProver";
import { MockChain } from "./MockChain";

export class MockAlwaysFailsAttestationProver {
    constructor(
        public chain: MockChain,
        public queryWindowSeconds: number,
    ) { }

    payment(transactionHash: string, inUtxo: number, utxo: number): Payment.ResponseBody {
        throw new MockAttestationProverError(`AttestationProver.payment: failed`);
    }

    balanceDecreasingTransaction(transactionHash: string, sourceAddressIndicator: string): BalanceDecreasingTransaction.ResponseBody {
        const method = 'balanceDecreasingTransaction';
        throw new MockAttestationProverError(`AttestationProver.balanceDecreasingTransaction: failed`);
    }

    referencedPaymentNonexistence(destinationAddressHash: string, paymentReference: string, amount: BN, startBlock: number, endBlock: number, endTimestamp: number): ReferencedPaymentNonexistence.ResponseBody {
        throw new MockAttestationProverError(`AttestationProver.referencedPaymentNonexistence: failed`);
    }

    confirmedBlockHeightExists(blockNumber: number, queryWindow: number): ConfirmedBlockHeightExists.ResponseBody {
        throw new MockAttestationProverError(`AttestationProver.confirmedBlockHeightExists: failed`);
    }
}
