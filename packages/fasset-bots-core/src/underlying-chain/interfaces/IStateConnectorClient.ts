import { ARBase, ARESBase } from "@flarenetwork/state-connector-protocol";

export class StateConnectorClientError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export interface AttestationRequestId {
    round: number;
    data: string;
}

export interface AttestationProof<RESPONSE extends ARESBase = ARESBase> {
    merkleProof: string[];
    data: RESPONSE;
}

export enum AttestationNotProved {
    NOT_FINALIZED = "NOT_FINALIZED",
    DISPROVED = "DISPROVED",
}

export type OptionalAttestationProof = AttestationProof<ARESBase> | AttestationNotProved;

// All methods build attestation request, submit it to the state connector and return the encoded request.
// We create one requester per chain, so chainId is baked in.
export interface IStateConnectorClient {
    account: string | undefined;
    roundFinalized(round: number): Promise<boolean>;
    waitForRoundFinalization(round: number): Promise<void>;
    submitRequest(request: ARBase): Promise<AttestationRequestId>;
    obtainProof(round: number, requestData: string): Promise<OptionalAttestationProof>;
}
