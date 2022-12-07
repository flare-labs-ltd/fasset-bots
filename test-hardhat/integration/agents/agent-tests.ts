import { time } from "@openzeppelin/test-helpers";
import { assert } from "chai";
import { AgentBot } from "../../../src/actors/AgentBot";
import { ORM } from "../../../src/config/orm";
import { Minter } from "../../../src/mock/Minter";
import { MockChain } from "../../../src/mock/MockChain";
import { Redeemer } from "../../../src/mock/Redeemer";
import { checkedCast, QUERY_WINDOW_SECONDS, toBN, toBNExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestOrm } from "../../../test/test.mikro-orm.config";
import { createTestAssetContext } from "../../utils/test-asset-context";
import { testChainInfo } from "../../../test/utils/TestChainInfo";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { MockAttestationProver } from "../../../src/mock/MockAttestationProver";
import { MockStateConnectorClient } from "../../../src/mock/MockStateConnectorClient";

describe("Agent bot tests", async () => {
    let accounts: string[];
    let context: IAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let redeemerAddress: string;
    let chain: MockChain;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        orm = await createTestOrm({ schemaUpdate: 'recreate' });
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.chain, MockChain);
        ownerAddress = accounts[3];
        minterAddress = accounts[4];
        redeemerAddress = accounts[5];
    });

    it("Should perform minting", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        await agentBot.agent.depositCollateral(toBNExp(1_000_000, 18));
        await agentBot.agent.makeAvailable(500, 25000);
        const minter = await Minter.createTest(context, minterAddress, "MINTER_ADDRESS", toBNExp(10_000, 6)); // lot is 1000 XRP
        chain.mine(chain.finalizationBlocks + 1);
        // create collateral reservation
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        // should have an open minting
        orm.em.clear();
        const mintings = await agentBot.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const minting = mintings[0];
        assert.equal(minting.state, 'started');
        // pay for and execute minting
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);
        // the minting status should now be 'done'
        orm.em.clear();
        const openMintingsAfter = await agentBot.openMintings(orm.em, false);
        assert.equal(openMintingsAfter.length, 0);
        const mintingAfter = await agentBot.findMinting(orm.em, minting.requestId);
        assert.equal(mintingAfter.state, 'done');
    });

    it("Should perform minting and redemption", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        await agentBot.agent.depositCollateral(toBNExp(1_000_000, 18));
        await agentBot.agent.makeAvailable(500, 25000);
        const minter = await Minter.createTest(context, minterAddress, "MINTER_ADDRESS_2", toBNExp(10_000, 6)); // lot is 1000 XRP
        const redeemer = await Redeemer.create(context, redeemerAddress, "REDEEMER_ADDRESS_2");
        chain.mine(chain.finalizationBlocks + 1);
        // perform minting
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);
        // transfer fassets
        const fbalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fbalance, { from: minter.address });
        // request redemption
        const [rdreqs] = await redeemer.requestRedemption(2);
        assert.equal(rdreqs.length, 1);
        const rdreq = rdreqs[0];
        // run agent's steps until redemption process is finished
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await agentBot.runStep(orm.em);
            // check if redemption is done
            orm.em.clear();
            const redemption = await agentBot.findRedemption(orm.em, rdreq.requestId);
            console.log(`Agent step ${i}, state=${redemption.state}`)
            if (redemption.state === 'done' || redemption.state === 'notRequestedProof') break;
        }
        // redeemer should now have some funds on the underlying chain
        const balance = await chain.getBalance(redeemer.underlyingAddress);
        assert.equal(String(balance), String(toBN(rdreq.valueUBA).sub(toBN(rdreq.feeUBA))));
    });

    it("Should not perform minting - minter does not pay", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        await agentBot.agent.depositCollateral(toBNExp(1_000_000, 18));
        await agentBot.agent.makeAvailable(500, 25000);
        const minter = await Minter.createTest(context, minterAddress, "MINTER_ADDRESS", toBNExp(10_000, 6)); // lot is 1000 XRP
        chain.mine(chain.finalizationBlocks + 1);
        // create collateral reservation
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        // should have an open minting
        orm.em.clear();
        let mintings = await agentBot.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const mintingStarted = mintings[0];
        assert.equal(mintingStarted.state, 'started');
        // skip time so the payment will expire on underlying chain
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp))
        chain.mine(Number(crt.lastUnderlyingBlock))
        await agentBot.runStep(orm.em);
        orm.em.clear();
        // should have one open minting with state 'requestedNonPaymentProof'
        mintings = await agentBot.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const mintingRequestedNonPaymentProof = mintings[0];
        assert.equal(mintingRequestedNonPaymentProof.state, 'requestedNonPaymentProof');
        // check if minting is done
        await agentBot.runStep(orm.em);
        orm.em.clear();
        const mintingDone = await agentBot.findMinting(orm.em, crt.collateralReservationId)
        assert.equal(mintingDone.state, 'done');
    });

    it("Should perform minting - minter pays, agent execute minting", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        await agentBot.agent.depositCollateral(toBNExp(1_000_000, 18));
        await agentBot.agent.makeAvailable(500, 25000);
        const minter = await Minter.createTest(context, minterAddress, "MINTER_ADDRESS", toBNExp(10_000, 6)); // lot is 1000 XRP
        chain.mine(chain.finalizationBlocks + 1);
        // create collateral reservation
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        // should have an open minting
        orm.em.clear();
        let mintings = await agentBot.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const mintingStarted = mintings[0];
        assert.equal(mintingStarted.state, 'started');
        // pay for minting
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        // skip time so the payment will expire on underlying chain
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp))
        chain.mine(Number(crt.lastUnderlyingBlock))
        await agentBot.runStep(orm.em);
        orm.em.clear();
        // should have one open minting with state 'requestedPaymentProof'
        mintings = await agentBot.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const mintingRequestedNonPaymentProof = mintings[0];
        assert.equal(mintingRequestedNonPaymentProof.state, 'requestedPaymentProof');
        // check if minting is done
        await agentBot.runStep(orm.em);
        orm.em.clear();
        const mintingDone = await agentBot.findMinting(orm.em, crt.collateralReservationId)
        assert.equal(mintingDone.state, 'done');
    });

    it("Should perform unstick minting - minter does not pay and time expires in indexer", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        await agentBot.agent.depositCollateral(toBNExp(1_000_000, 18));
        await agentBot.agent.makeAvailable(500, 25000);
        const minter = await Minter.createTest(context, minterAddress, "MINTER_ADDRESS", toBNExp(10_000, 6)); // lot is 1000 XRP
        chain.mine(chain.finalizationBlocks + 1);
        // create collateral reservation
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        // should have an open minting
        orm.em.clear();
        let mintings = await agentBot.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const mintingStarted = mintings[0];
        assert.equal(mintingStarted.state, 'started');
        // skip time so the proof will expire in indexer
        const queryWindow = QUERY_WINDOW_SECONDS * 2;
        const queryBlock = Math.round(queryWindow / chain.secondsPerBlock);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp) + queryWindow)
        chain.mine(Number(crt.lastUnderlyingBlock) + queryBlock)
        await agentBot.runStep(orm.em);
        orm.em.clear();
        // check if minting is done
        await agentBot.runStep(orm.em);
        orm.em.clear();
        const mintingDone = await agentBot.findMinting(orm.em, crt.collateralReservationId)
        assert.equal(mintingDone.state, 'done');
    });

    it("Should perform unstick minting - minter pays and time expires in indexer", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        await agentBot.agent.depositCollateral(toBNExp(1_000_000, 18));
        await agentBot.agent.makeAvailable(500, 25000);
        const minter = await Minter.createTest(context, minterAddress, "MINTER_ADDRESS", toBNExp(10_000, 6)); // lot is 1000 XRP
        chain.mine(chain.finalizationBlocks + 1);
        // create collateral reservation
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        // should have an open minting
        orm.em.clear();
        let mintings = await agentBot.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const mintingStarted = mintings[0];
        assert.equal(mintingStarted.state, 'started');
        // pay for minting
        await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        // skip time so the proof will expire in indexer
        const queryWindow = QUERY_WINDOW_SECONDS * 2;
        const queryBlock = Math.round(queryWindow / chain.secondsPerBlock);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp) + queryWindow)
        chain.mine(Number(crt.lastUnderlyingBlock) + queryBlock)
        await agentBot.runStep(orm.em);
        orm.em.clear();
        // check if minting is done
        await agentBot.runStep(orm.em);
        orm.em.clear();
        const mintingDone = await agentBot.findMinting(orm.em, crt.collateralReservationId)
        assert.equal(mintingDone.state, 'done');
    });
});
