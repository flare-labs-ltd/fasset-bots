import { expect } from "chai";
import { StateConnectorClientHelper } from "../../../src/underlying-chain/StateConnectorClientHelper";
import { requireEnv } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
import { createTestStateConnectorClient } from "../../utils/test-bot-config";

let stateConnectorClient: StateConnectorClientHelper;
const costonRPCUrl: string = requireEnv('COSTON2_RPC_URL');
const accountPrivateKey = requireEnv('OWNER_PRIVATE_KEY');

const roundIdC2 = 413192;
const requestDataBytesC2_1 = "0x000300000001bfa8ccefbe3307418d00a88fbb180e1ee63cf33cb5388245d519c6de150f1bd4";
const requestDataBytesC2_2 = "0x000400000001d5416a66687e4a3b8f1244157cd04572c3954ceaeccc795b802361e8e958afa50028390563bba04bbcea6e5be2292a8082fbdd1a4fcdf4f8964563d954323c45a6abaa05da7228c5548d92e261443a5bf13857c4e2bcd8571458567f5d20b8d9e5ac21ab3a69f236dd4e9113c8216513e460cbb268de5d24";
const requestDataBytesC2_3 = "0x0001000000016afa762068996971cc45283b0012e847e2a85e6e980db32e53cf51d7e0df9d126bacfde48b6bc09d950707da39446a053a2e8e596e24e5b1de9eecb26ad777c20000";
const requestDataBytesC2_4 = "0x0002000000015d3575e92106318656c874687b19c26337cadda3f63a755846f4774f3d520695f624581ae6c6cc7a71032c8ae6d3de1e3a9a4b7640c8a8b917ae062efa9b457d00";

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
