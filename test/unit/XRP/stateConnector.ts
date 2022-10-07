import { expect } from "chai";
import { StateConnectorClientHelper } from "../../../src/underlying-chain/StateConnectorClientHelper";

let stateConnectorClient: StateConnectorClientHelper;
const attestationUrl: string = process.env.COSTON_ATTESTER_BASE_URL || "";
const constonRPCUrl: string = process.env.CONSTON_RPC_URL || "";
const attestationClientAddress: string = process.env.COSTON_ATTESTATION_CLIENT_ADDRESS || "";
const stateConnectorAddress: string = process.env.COSTON_STATE_CONNECTOR_ADDRESS || "";
const account: string = process.env.COSTON_ACCOUNT || ""; 

const roundId = 322841;
const requestDataBytes = "0x000300000002e06c5126d3068cc6c39c25f0182692b03129e76e19d9a7277dc5dcada19e631e";

describe("XRP attestation/state connector tests", async () => {

    before(async () => {
        stateConnectorClient = new StateConnectorClientHelper(attestationUrl, constonRPCUrl, attestationClientAddress, stateConnectorAddress, account);
    })

    it("Should return round is finalized", async () => {
        const isRoundFinalized = await stateConnectorClient.roundFinalized(roundId);
        expect(isRoundFinalized).to.be.true;
    });

    it("Should return round is not finalized", async () => {
        const round = roundId + 1000000000000;
        const isRoundFinalized = await stateConnectorClient.roundFinalized(round);
        expect(isRoundFinalized).to.be.false;
    });

    it.skip("Should submit request", async () => {
        const resp = await stateConnectorClient.submitRequest(requestDataBytes);
        console.log(resp);
    });

    it.skip("Should obtain proof", async () => {
        const proof = await stateConnectorClient.obtainProof(roundId, requestDataBytes);
        console.log(proof);
    });

});
