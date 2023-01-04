import { expectRevert, time } from "@openzeppelin/test-helpers";
import { assert } from "chai";
import { AgentBot, AgentStatus } from "../../src/actors/AgentBot";
import { ORM } from "../../src/config/orm";
import { Minter } from "../../src/mock/Minter";
import { MockChain } from "../../src/mock/MockChain";
import { Redeemer } from "../../src/mock/Redeemer";
import { checkedCast, QUERY_WINDOW_SECONDS, toBN, toBNExp } from "../../src/utils/helpers";
import { web3 } from "../../src/utils/web3";
import { createTestOrm } from "../../test/test.mikro-orm.config";
import { createTestAssetContext, TestAssetBotContext } from "../utils/test-asset-context";
import { testChainInfo } from "../../test/utils/TestChainInfo";
import { IAssetBotContext } from "../../src/fasset-bots/IAssetBotContext";
import { AgentEntity, AgentMintingState, AgentRedemptionState } from "../../src/entities/agent";
import { disableMccTraceManager } from "../utils/helpers";
import { FilterQuery } from "@mikro-orm/core/typings";

const minterUnderlying: string = "MINTER_ADDRESS";
const redeemerUnderlying: string = "REDEEMER_ADDRESS";

describe("Agent bot tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let redeemerAddress: string;
    let chain: MockChain;
    let settings: any;
    let agentBot: AgentBot;
    let minter: Minter;
    let redeemer: Redeemer;

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
        orm = await createTestOrm({ schemaUpdate: 'recreate' });
        ownerAddress = accounts[3];
        minterAddress = accounts[4];
        redeemerAddress = accounts[5];
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.chain, MockChain);
        settings = await context.assetManager.getSettings();
        agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        await agentBot.agent.depositCollateral(toBNExp(1_000_000, 18));
        await agentBot.agent.makeAvailable(500, 25000);
        minter = await Minter.createTest(context, minterAddress, minterUnderlying, toBNExp(10_000, 6)); // lot is 1000 XRP
        chain.mine(chain.finalizationBlocks + 1);
        redeemer = await Redeemer.create(context, redeemerAddress, redeemerUnderlying);
    });

    it("Should perform minting", async () => {
        // create collateral reservation
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        // should have an open minting
        orm.em.clear();
        const mintings = await agentBot.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const minting = mintings[0];
        assert.equal(minting.state, AgentMintingState.STARTED);
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
        assert.equal(mintingAfter.state, AgentMintingState.DONE);
    });

    it("Should perform minting and redemption", async () => {
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
            console.log(`Agent step ${i}, state=${redemption.state}`);
            if (redemption.state === AgentRedemptionState.DONE) break;
        }
        // redeemer should now have some funds on the underlying chain
        const balance = await chain.getBalance(redeemer.underlyingAddress);
        assert.equal(String(balance), String(toBN(rdreq.valueUBA).sub(toBN(rdreq.feeUBA))));
    });

    it("Should not perform minting - minter does not pay", async () => {
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
        assert.equal(mintingRequestedNonPaymentProof.state, AgentMintingState.REQUEST_NON_PAYMENT_PROOF);
        // check if minting is done
        await agentBot.runStep(orm.em);
        orm.em.clear();
        const mintingDone = await agentBot.findMinting(orm.em, crt.collateralReservationId)
        assert.equal(mintingDone.state, 'done');
        // check that executing minting after calling mintingPaymentDefault will revert
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await expectRevert(minter.executeMinting(crt, txHash), "invalid crt id");
    });

    it("Should perform minting - minter pays, agent execute minting", async () => {
        // create collateral reservation
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        // should have an open minting
        orm.em.clear();
        let mintings = await agentBot.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const mintingStarted = mintings[0];
        assert.equal(mintingStarted.state, AgentMintingState.STARTED);
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
        assert.equal(mintingRequestedNonPaymentProof.state, AgentMintingState.REQUEST_PAYMENT_PROOF);
        // check if minting is done
        await agentBot.runStep(orm.em);
        orm.em.clear();
        const mintingDone = await agentBot.findMinting(orm.em, crt.collateralReservationId)
        assert.equal(mintingDone.state, AgentMintingState.DONE);
    });

    it("Should perform unstick minting - minter does not pay and time expires in indexer", async () => {
        // create collateral reservation
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        // should have an open minting
        orm.em.clear();
        let mintings = await agentBot.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const mintingStarted = mintings[0];
        assert.equal(mintingStarted.state, AgentMintingState.STARTED);
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
        assert.equal(mintingDone.state, AgentMintingState.DONE);
    });

    it("Should perform unstick minting - minter pays and time expires in indexer", async () => {
        // create collateral reservation
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        // should have an open minting
        orm.em.clear();
        let mintings = await agentBot.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const mintingStarted = mintings[0];
        assert.equal(mintingStarted.state, AgentMintingState.STARTED);
        // pay for minting
        const txHash = await minter.performMintingPayment(crt);
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
        assert.equal(mintingDone.state, AgentMintingState.DONE);
        // check that executing minting after calling unstickMinting will revert
        await expectRevert(minter.executeMinting(crt, txHash), "invalid crt id");
    });

    it("Should not perform redemption - agent does not pay, time expires on underlying", async () => {
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
        // skip time so the payment will expire on underlying chain
        chain.skipTimeTo(Number(rdreq.lastUnderlyingTimestamp))
        chain.mine(Number(rdreq.lastUnderlyingBlock))
        // redeemer requests non-payment proof 
        // redeemer triggers payment default and gets paid in collateral with extra
        const startBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
        const startBalanceAgent = await context.wnat.balanceOf(agentBot.agent.agentVault.address);
        const res = await redeemer.redemptionPaymentDefault(rdreq);
        const endBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
        const endBalanceAgent = await context.wnat.balanceOf(agentBot.agent.agentVault.address);
        assert.equal(String(endBalanceRedeemer.sub(startBalanceRedeemer)), String(res.redeemedCollateralWei));
        assert.equal(String(startBalanceAgent.sub(endBalanceAgent)), String(res.redeemedCollateralWei));
        // check if redemption is done
        await agentBot.runStep(orm.em);
        orm.em.clear();
        const redemptionDone = await agentBot.findRedemption(orm.em, rdreq.requestId);
        assert.equal(redemptionDone.state, AgentRedemptionState.DONE);
    });

    it("Should not perform redemption - agent does not pay, time expires in indexer", async () => {
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
        // skip time so the proof will expire in indexer
        const queryWindow = QUERY_WINDOW_SECONDS * 2;
        const queryBlock = Math.round(queryWindow / chain.secondsPerBlock);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp) + queryWindow)
        chain.mine(Number(crt.lastUnderlyingBlock) + queryBlock)
        // check if redemption is done
        await agentBot.runStep(orm.em);
        orm.em.clear();
        const redemptionDone = await agentBot.findRedemption(orm.em, rdreq.requestId);
        assert.equal(redemptionDone.state, AgentRedemptionState.DONE);
    });

    it("Should not perform redemption - agent pays, time expires in indexer", async () => {
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
        // agent pays
        await agentBot.runStep(orm.em);
        const redemptionPaid = await agentBot.findRedemption(orm.em, rdreq.requestId);
        assert.equal(redemptionPaid.state, AgentRedemptionState.PAID);
        // skip time so the proof will expire in indexer
        const queryWindow = QUERY_WINDOW_SECONDS * 2;
        const queryBlock = Math.round(queryWindow / chain.secondsPerBlock);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp) + queryWindow)
        chain.mine(Number(crt.lastUnderlyingBlock) + queryBlock)
        // check if redemption is done
        await agentBot.runStep(orm.em);
        orm.em.clear();
        const redemptionDone = await agentBot.findRedemption(orm.em, rdreq.requestId);
        assert.equal(redemptionDone.state, AgentRedemptionState.DONE);
    });

    it("Should not perform redemption - agent does not confirm, anyone can confirm time expired on underlying", async () => {
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
        // redemption has started and is paid
        await agentBot.runStep(orm.em);
        orm.em.clear();
        const redemptionPaid = await agentBot.findRedemption(orm.em, rdreq.requestId);
        assert.equal(redemptionPaid.state, AgentRedemptionState.PAID);
        // agent does not confirm payment
        await agentBot.runStep(orm.em, true);
        orm.em.clear();
        const redemptionNotConfirmed = await agentBot.findRedemption(orm.em, rdreq.requestId);
        assert.equal(redemptionNotConfirmed.state, AgentRedemptionState.NOT_REQUESTED_PROOF);
        // others can confirm redemption payment after some time
        await time.increase(settings.confirmationByOthersAfterSeconds);
        chain.mine(chain.finalizationBlocks + 1);
        const someAddress = accounts[10];
        const startBalance = await context.wnat.balanceOf(someAddress);
        const proof = await context.attestationProvider.provePayment(redemptionPaid.txHash!, agentBot.agent.underlyingAddress, rdreq.paymentAddress);
        await context.assetManager.confirmRedemptionPayment(proof, rdreq.requestId, { from: someAddress });
        const endBalance = await context.wnat.balanceOf(someAddress);
        assert.equal(String(endBalance.sub(startBalance)), String(settings.confirmationByOthersRewardNATWei));
    });

    it("Should perform minting and change status from NORMAL to LIQUIDATION", async () => {
        // create collateral reservation
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        // should have an open minting
        orm.em.clear();
        const mintings = await agentBot.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const minting = mintings[0];
        assert.equal(minting.state, AgentMintingState.STARTED);
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
        assert.equal(mintingAfter.state, AgentMintingState.DONE);
        // check status in agent bot entity
        const agentBotEnt = await orm.em.findOne(AgentEntity, { vaultAddress: agentBot.agent.agentVault.address, } as FilterQuery<AgentEntity>);
        assert.equal(agentBotEnt?.status, AgentStatus.NORMAL);
        await context.assetFtso.setCurrentPrice(toBNExp(3521, 50), 0);
        await context.assetManager.startLiquidation(agentBot.agent.vaultAddress);
        await agentBot.runStep(orm.em);
        // handle status change and entity
        await agentBot.runStep(orm.em);
        assert.equal(agentBotEnt?.status, AgentStatus.LIQUIDATION);
    });

    it("Should perform minting and change status from NORMAL via LIQUIDATION to NORMAL", async () => {
        // create collateral reservation
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        // should have an open minting
        orm.em.clear();
        const mintings = await agentBot.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const minting = mintings[0];
        assert.equal(minting.state, AgentMintingState.STARTED);
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
        assert.equal(mintingAfter.state, AgentMintingState.DONE);
        // check status in agent bot entity
        const agentBotEnt = await orm.em.findOne(AgentEntity, { vaultAddress: agentBot.agent.agentVault.address, } as FilterQuery<AgentEntity>);
        assert.equal(agentBotEnt?.status, AgentStatus.NORMAL);
        // change price
        const { 0: assetPrice } = await context.assetFtso.getCurrentPrice();
        await context.assetFtso.setCurrentPrice(assetPrice.muln(10000), 0);
        // start liquidation
        await context.assetManager.startLiquidation(agentBot.agent.vaultAddress);
        // handle status change and entity
        await agentBot.runStep(orm.em);
        assert.equal(agentBotEnt?.status, AgentStatus.LIQUIDATION);
        // change price back
        const { 0: assetPrice2 } = await context.assetFtso.getCurrentPrice();
        await context.assetFtso.setCurrentPrice(assetPrice2.divn(10000), 0);
        // agent ends liquidation
        await agentBot.agent.endLiquidation();
        // handle status change and entity
        await agentBot.runStep(orm.em);
        assert.equal(agentBotEnt?.status, AgentStatus.NORMAL);
    });

});