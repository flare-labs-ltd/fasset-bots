import { expect } from "chai";
import { StateConnectorClientHelper } from "../../../src/underlying-chain/StateConnectorClientHelper";

let stateConnectorClient: StateConnectorClientHelper;
const attestationUrl: string = process.env.COSTON_ATTESTER_BASE_URL || "";
const constonRPCUrl: string = process.env.CONSTON_RPC_URL || "";

const roundId = 298932;

describe("XRP attestation/state connector tests", async () => {

    before(async () => {
        stateConnectorClient = new StateConnectorClientHelper(attestationUrl, constonRPCUrl);
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

});
