import { expect } from "chai";
import { StateConnectorClientHelper } from "../../../src/underlying-chain/StateConnectorClientHelper";
import { requireEnv } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";

let stateConnectorClient: StateConnectorClientHelper;
const attestationUrl: string = requireEnv('COSTON2_ATTESTER_BASE_URL');
const costonRPCUrl: string = requireEnv('COSTON2_RPC_URL');
const attestationClientAddress: string = requireEnv('COSTON2_ATTESTATION_CLIENT_ADDRESS');
const stateConnectorAddress: string = requireEnv('COSTON2_STATE_CONNECTOR_ADDRESS');
const account = requireEnv('COSTON2_ACCOUNT');
const accountPrivateKey = requireEnv('COSTON2_ACCOUNT_PRIVATE_KEY');

const roundIdC2 = 309691;
const requestDataBytesC2 = "0x000100000003b4c8cd83c70ef7c9e7d38bc8de67be914a1840eb36db8f73a37a65191b529fd3a58d32f6c898d737cf8c38e16478f52becd85dc2e3c12813de2c3adfb4f559ed0000";

describe("XRP attestation/state connector tests", async () => {
    before(async () => {
        await initWeb3(costonRPCUrl, [accountPrivateKey], null);
        stateConnectorClient = await StateConnectorClientHelper.create(attestationUrl, attestationClientAddress, stateConnectorAddress, account);
    })

    it("Should return round is finalized", async () => {
        const isRoundFinalized = await stateConnectorClient.roundFinalized(roundIdC2);
        expect(isRoundFinalized).to.be.true;
    });

    it("Should return round is not finalized", async () => {
        const round = roundIdC2 + 1000000000000;
        const isRoundFinalized = await stateConnectorClient.roundFinalized(round);
        expect(isRoundFinalized).to.be.false;
    });

    it("Should submit request", async () => {
        const resp = await stateConnectorClient.submitRequest(requestDataBytesC2);
        console.log(resp);
    });

    it("Should obtain proof", async () => {
        const proof = await stateConnectorClient.obtainProof(roundIdC2, requestDataBytesC2);
        console.log(proof);
    });

});
