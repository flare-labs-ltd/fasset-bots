import { expect } from "chai";
import { StateConnectorClientHelper } from "../../../src/underlying-chain/StateConnectorClientHelper";
import { requireEnv } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
import { createTestStateConnectorClient } from "../../utils/test-bot-config";

let stateConnectorClient: StateConnectorClientHelper;
const costonRPCUrl: string = requireEnv('COSTON2_RPC_URL');
const account = requireEnv('COSTON2_ACCOUNT');
const accountPrivateKey = requireEnv('COSTON2_ACCOUNT_PRIVATE_KEY');

const roundIdC2 = 388728;
const requestDataBytesC2_1 = "0x0003000000011711319cbe00bf3fb1446bd221e0ec03a7df48d86aad43c1efd38b4b7c871563";
const requestDataBytesC2_2 = "0x00040000000103734f76266db944d215163aff60353d75e30f1091666d779b14a1f46a4006730027fafe639a1f390ee83174e8fbca00c692b44f06a0adfadb0da9f929b0b371a3040618e71d2534f522a75304e54742d7d5d0b440a6cc2a7c17883f766aab51e86b11d4f6a5ff8f1155a53ee8c1d00192bc387975850248";
const requestDataBytesC2_3 = "0x000100000001045f58873409d75a00ca2b8d5bc7b4bd337f40087ec8012fabe904bceea4ba13d8ac4266dc150a93020b252f3518089db2f8d5368917682bb9112eda7f204c920000";
const requestDataBytesC2_4 = "0x000200000001045f58873409d75a00ca2b8d5bc7b4bd337f40087ec8012fabe904bceea4ba13f7d1b5ef2709b71c78de6071e603a6cb45c022c8d3a43070d5e069c4a197d00e00";

describe("XRP attestation/state connector tests", async () => {
    before(async () => {
        await initWeb3(costonRPCUrl, [accountPrivateKey], null);
        stateConnectorClient = await createTestStateConnectorClient();
    })

    it("Should return round is finalized", async () => {
        const isRoundFinalized = await stateConnectorClient.roundFinalized(roundIdC2);
        expect(isRoundFinalized).to.be.true;
    });

    it("Should wait for round finalization", async () => {
        await stateConnectorClient.waitForRoundFinalization(roundIdC2);
    });

    it("Should return round is not finalized", async () => {
        const round = roundIdC2 + 1000000000000;
        const isRoundFinalized = await stateConnectorClient.roundFinalized(round);
        expect(isRoundFinalized).to.be.false;
    });

    it("Should submit request", async () => {
        const resp = await stateConnectorClient.submitRequest(requestDataBytesC2_1);
        expect(resp.round).to.be.greaterThan(0);
    });
//TODO-FIX
    it("Should obtain proof", async () => {
        const proof1 = await stateConnectorClient.obtainProof(roundIdC2, requestDataBytesC2_1);
        expect(proof1.finalized).to.be.true;
        const proof2 = await stateConnectorClient.obtainProof(roundIdC2, requestDataBytesC2_2);
        expect(proof2.finalized).to.be.true;
        const proof3 = await stateConnectorClient.obtainProof(roundIdC2, requestDataBytesC2_3);
        expect(proof3.finalized).to.be.true;
        const proof4 = await stateConnectorClient.obtainProof(roundIdC2, requestDataBytesC2_4);
        expect(proof4.finalized).to.be.true;
    });

});
