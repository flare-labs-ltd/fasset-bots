import { time } from "@openzeppelin/test-helpers";
import { assert } from "chai";
import { AgentBot, AgentStatus } from "../../src/actors/AgentBot";
import { EM, ORM } from "../../src/config/orm";
import { Minter } from "../../src/mock/Minter";
import { MockChain } from "../../src/mock/MockChain";
import { Redeemer } from "../../src/mock/Redeemer";
import { checkedCast, sleep, toBN, toBNExp } from "../../src/utils/helpers";
import { web3 } from "../../src/utils/web3";
import { createTestOrm } from "../../test/test.mikro-orm.config";
import { createTestAssetContext } from "../utils/test-asset-context";
import { testChainInfo } from "../../test/utils/TestChainInfo";
import { IAssetBotContext } from "../../src/fasset-bots/IAssetBotContext";
import { ScopedRunner } from "../../src/utils/events/ScopedRunner";
import { PaymentReference } from "../../src/fasset/PaymentReference";
import { AgentEntity, AgentRedemptionState } from "../../src/entities/agent";
import { FilterQuery } from "@mikro-orm/core/typings";
import { ProvedDH } from "../../src/underlying-chain/AttestationHelper";
import { DHPayment } from "../../src/verification/generated/attestation-hash-types";
import { ActorEntity, ActorType } from "../../src/entities/actor";
import { disableMccTraceManager } from "../utils/helpers";
import { Challenger } from "../../src/actors/Challenger";
import { TrackedState } from "../../src/state/TrackedState";
import { TransactionOptionsWithFee } from "../../src/underlying-chain/interfaces/IBlockChainWallet";
import { TX_BLOCKED } from "../../src/underlying-chain/interfaces/IBlockChain";
const chai = require('chai');
const spies = require('chai-spies');
chai.use(spies);
const expect = chai.expect;

const minterUnderlying: string = "MINTER_ADDRESS";
const redeemerUnderlying: string = "REDEEMER_ADDRESS";

type MockTransactionOptionsWithFee = TransactionOptionsWithFee & { status?: number };

describe("Challenger tests", async () => {
    let accounts: string[];
    let context: IAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let redeemerAddress: string;
    let challengerAddress: string;
    let chain: MockChain;
    let runner: ScopedRunner;
    let agentBot: AgentBot;
    let minter: Minter;
    let redeemer: Redeemer;
    let state: TrackedState;

    async function getAgentStatus(agentBot: AgentBot): Promise<number> {
        const agentInfo = await agentBot.agent.getAgentInfo();
        return Number(agentInfo.status) as AgentStatus;
    }

    async function createTestChallenger(runner: ScopedRunner, rootEm: EM, context: IAssetBotContext, address: string): Promise<Challenger> {
        const challengerEnt = await rootEm.findOne(ActorEntity, { address: address, type: ActorType.CHALLENGER } as FilterQuery<ActorEntity>);
        if (challengerEnt) {
            return await Challenger.fromEntity(runner, context, challengerEnt, state);
        } else {
            return await Challenger.create(runner, rootEm, context, address, state);
        }
    }

    async function createTestActors(ownerAddress: string, minterAddress: string, redeemerAddress: string, minterUnderlying: string, redeemerUnderlying: string): Promise<void> {
        agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        await agentBot.agent.depositCollateral(toBNExp(100_000_000, 18));
        await agentBot.agent.makeAvailable(500, 3_0000);
        minter = await Minter.createTest(context, minterAddress, minterUnderlying, toBNExp(100_000, 18));
        chain.mine(chain.finalizationBlocks + 1);
        redeemer = await Redeemer.create(context, redeemerAddress, redeemerUnderlying);
    }

    async function createCRAndPerformMinting(minter: Minter, agentBot: AgentBot, lots: number) {
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, lots);
        await agentBot.runStep(orm.em);
        const txHash0 = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash0);
        await agentBot.runStep(orm.em);
    }

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
        ownerAddress = accounts[3];
        minterAddress = accounts[4];
        redeemerAddress = accounts[5];
        challengerAddress = accounts[6];
        orm = await createTestOrm({ schemaUpdate: 'recreate' });
    });

    beforeEach(async () => {
        orm.em.clear();
        runner = new ScopedRunner();
        state = new TrackedState();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp, false);
        chain = checkedCast(context.chain, MockChain);
        // chain tunning
        chain.finalizationBlocks = 0;
        chain.secondsPerBlock = 1;
    });

    it("Should challenge illegal payment", async () => {
        const challenger = await createTestChallenger(runner, orm.em, context, challengerAddress);
        // create test actors
        await createTestActors(ownerAddress, minterAddress, redeemerAddress, minterUnderlying, redeemerUnderlying);
        await challenger.runStep(orm.em);
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 2);
        // perform illegal payment
        const agentInfo = await agentBot.agent.getAgentInfo();
        await agentBot.agent.performPayment(agentInfo.underlyingAddressString, toBN(agentInfo.mintedUBA).divn(2));
        // run challenger's steps until agent's status is FULL_LIQUIDATION
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await sleep(3000);
            await challenger.runStep(orm.em);
            const agentStatus = await getAgentStatus(agentBot);
            console.log(`Challenger step ${i}, agent status = ${AgentStatus[agentStatus]}`)
            if (agentStatus === AgentStatus.FULL_LIQUIDATION) break;
        }
        // send notification
        await agentBot.runStep(orm.em);
        // check status
        const agentStatus = await getAgentStatus(agentBot);
        assert.equal(agentStatus, AgentStatus.FULL_LIQUIDATION);
    });

    it("Should challenge illegal payment - reference for nonexisting redemption", async () => {
        const challenger = await createTestChallenger(runner, orm.em, context, challengerAddress);
        // create test actors
        await createTestActors(ownerAddress, minterAddress, redeemerAddress, minterUnderlying, redeemerUnderlying);
        await challenger.runStep(orm.em);
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 2);
        // perform illegal payment
        const agentInfo = await agentBot.agent.getAgentInfo();
        await agentBot.agent.performPayment(agentInfo.underlyingAddressString, toBN(agentInfo.mintedUBA).divn(2), PaymentReference.redemption(15));
        // run challenger's steps until agent's status is FULL_LIQUIDATION
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await sleep(3000);
            await challenger.runStep(orm.em);
            const agentStatus = await getAgentStatus(agentBot);
            console.log(`Challenger step ${i}, agent status = ${AgentStatus[agentStatus]}`)
            if (agentStatus === AgentStatus.FULL_LIQUIDATION) break;
        }
        const agentStatus = await getAgentStatus(agentBot);
        assert.equal(agentStatus, AgentStatus.FULL_LIQUIDATION);
    });

    it("Should challenge double payment", async () => {
        const challenger = await createTestChallenger(runner, orm.em, context, challengerAddress);
        // create test actors
        await createTestActors(ownerAddress, minterAddress, redeemerAddress, minterUnderlying, redeemerUnderlying);
        await challenger.runStep(orm.em);
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 50);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // perform redemption
        const [reqs] = await redeemer.requestRedemption(2);
        const rdReq = reqs[0];
        // run agent's steps until redemption process is finished
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await agentBot.runStep(orm.em);
            // check if redemption is done
            orm.em.clear();
            const redemption = await agentBot.findRedemption(orm.em, rdReq.requestId);
            console.log(`Agent step ${i}, state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.DONE) break;
        }
        const agentStatus1 = await getAgentStatus(agentBot);
        assert.equal(agentStatus1, AgentStatus.NORMAL);
        // repeat the same payment
        await agentBot.agent.performRedemptionPayment(reqs[0]);
        // run challenger's steps until agent's status is FULL_LIQUIDATION
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await sleep(3000);
            await challenger.runStep(orm.em);
            const agentStatus = await getAgentStatus(agentBot);
            console.log(`Challenger step ${i}, agent status = ${AgentStatus[agentStatus]}`)
            if (agentStatus === AgentStatus.FULL_LIQUIDATION) break;
        }
        // send notification
        await agentBot.runStep(orm.em);
        const agentStatus2 = await getAgentStatus(agentBot);
        assert.equal(agentStatus2, AgentStatus.FULL_LIQUIDATION);
    });

    it("Should challenge double payment - announced withdrawal", async () => {
        const challenger = await createTestChallenger(runner, orm.em, context, challengerAddress);
        // create test actors
        await createTestActors(ownerAddress, minterAddress, redeemerAddress, minterUnderlying, redeemerUnderlying);
        await challenger.runStep(orm.em);
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 50);
        const agentInfo = await agentBot.agent.getAgentInfo();
        const announce = await agentBot.agent.announceUnderlyingWithdrawal();
        await agentBot.agent.performPayment(agentInfo.underlyingAddressString, toBN(agentInfo.freeUnderlyingBalanceUBA).divn(2), announce.paymentReference);
        chain.mine(chain.finalizationBlocks + 1);
        // repeat the same payment
        await agentBot.agent.performPayment(agentInfo.underlyingAddressString, toBN(agentInfo.freeUnderlyingBalanceUBA).divn(2), announce.paymentReference);
        // run challenger's steps until agent's status is FULL_LIQUIDATION
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await sleep(3000);
            await challenger.runStep(orm.em);
            const agentStatus = await getAgentStatus(agentBot);
            console.log(`Challenger step ${i}, agent status = ${AgentStatus[agentStatus]}`)
            if (agentStatus === AgentStatus.FULL_LIQUIDATION) break;
        }
        const agentStatus2 = await getAgentStatus(agentBot);
        assert.equal(agentStatus2, AgentStatus.FULL_LIQUIDATION);
    });

    it("Should challenge illegal payment - reference for already confirmed redemption", async () => {
        const challenger = await createTestChallenger(runner, orm.em, context, challengerAddress);
        // create test actors
        await createTestActors(ownerAddress, minterAddress, redeemerAddress, minterUnderlying, redeemerUnderlying);
        await challenger.runStep(orm.em);
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 50);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // create redemption requests and perform redemption
        const [reqs] = await redeemer.requestRedemption(10);
        const rdReq = reqs[0];
        // run agent's steps until redemption process is finished
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await agentBot.runStep(orm.em);
            // check if redemption is done
            orm.em.clear();
            const redemption = await agentBot.findRedemption(orm.em, rdReq.requestId);
            console.log(`Agent step ${i}, state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.REQUESTED_PROOF) break;
        }
        // repeat the same payment (already confirmed)
        await agentBot.agent.performRedemptionPayment(rdReq);
        // run challenger's and agent's steps until agent's status is FULL_LIQUIDATION
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await sleep(3000);
            await challenger.runStep(orm.em);
            await agentBot.runStep(orm.em);
            const agentStatus = await getAgentStatus(agentBot);
            console.log(`Challenger step ${i}, agent status = ${AgentStatus[agentStatus]}`)
            if (agentStatus === AgentStatus.FULL_LIQUIDATION) break;
        }
        const agentStatus = await getAgentStatus(agentBot);
        assert.equal(agentStatus, AgentStatus.FULL_LIQUIDATION);
    });

    it("Should challenge illegal payment - reference for already confirmed announced withdrawal", async () => {
        const challenger = await createTestChallenger(runner, orm.em, context, challengerAddress);
        // create test actors
        await createTestActors(ownerAddress, minterAddress, redeemerAddress, minterUnderlying, redeemerUnderlying);
        await challenger.runStep(orm.em);
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 50);
        const agentInfo = await agentBot.agent.getAgentInfo();
        // announce underlying withdrawal
        const announce = await agentBot.agent.announceUnderlyingWithdrawal();
        const txHash = await agentBot.agent.performPayment(agentInfo.underlyingAddressString, toBN(agentInfo.freeUnderlyingBalanceUBA).divn(2), announce.paymentReference);
        chain.mine(chain.finalizationBlocks + 1);
        const skipTime = (await context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds
        await time.increase(skipTime);
        // confirm underlying withdrawal
        await agentBot.agent.confirmUnderlyingWithdrawal(announce, txHash);
        // repeat the same payment
        await agentBot.agent.performPayment(agentInfo.underlyingAddressString, toBN(agentInfo.freeUnderlyingBalanceUBA).divn(2), announce.paymentReference);
        // run challenger's steps until agent's status is FULL_LIQUIDATION
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await sleep(3000);
            await challenger.runStep(orm.em);
            const agentStatus = await getAgentStatus(agentBot);
            console.log(`Challenger step ${i}, agent status = ${AgentStatus[agentStatus]}`)
            if (agentStatus === AgentStatus.FULL_LIQUIDATION) break;
        }
        const agentStatus2 = await getAgentStatus(agentBot);
        assert.equal(agentStatus2, AgentStatus.FULL_LIQUIDATION);
    });

    it("Should catch 'RedemptionPaymentFailed' event - failed underlying payment (not redeemer's address)", async () => {
        const challenger = await createTestChallenger(runner, orm.em, context, challengerAddress);
        // create test actors
        await createTestActors(ownerAddress, minterAddress, redeemerAddress, minterUnderlying, redeemerUnderlying);
        await challenger.runStep(orm.em);
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 1);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // perform redemption
        const [reqs] = await redeemer.requestRedemption(1);
        const rdReq = reqs[0];
        // create redemption entity
        await agentBot.handleEvents(orm.em);
        const redemption = await agentBot.findRedemption(orm.em, rdReq.requestId);
        expect(redemption.state).eq(AgentRedemptionState.STARTED);
        // pay for redemption - wrong underlying address, also tweak redemption to trigger low underlying balance alert
        redemption.paymentAddress = minter.underlyingAddress;
        const agentBalance = await context.chain.getBalance(agentBot.agent.underlyingAddress);
        redemption.valueUBA = toBN(agentBalance);
        chain.requiredFee = redemption.feeUBA;
        await agentBot.payForRedemption(redemption);
        expect(redemption.state).eq(AgentRedemptionState.PAID);
        // check payment proof is available
        await agentBot.nextRedemptionStep(orm.em, redemption.id);
        expect(redemption.state).eq(AgentRedemptionState.REQUESTED_PROOF);
        // check start balance
        const startBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
        const startBalanceAgent = await context.wnat.balanceOf(agentBot.agent.agentVault.address);
        // confirm payment proof is available
        const proof = await context.attestationProvider.obtainPaymentProof(redemption.proofRequestRound!, redemption.proofRequestData!);
        const paymentProof = proof.result as ProvedDH<DHPayment>;
        const res = await context.assetManager.confirmRedemptionPayment(paymentProof, redemption.requestId, { from: agentBot.agent.ownerAddress });
        // finish redemption
        await agentBot.runStep(orm.em);
        expect(redemption.state).eq(AgentRedemptionState.DONE);
        // catch 'RedemptionPaymentFailed' event
        await challenger.runStep(orm.em);
        let argsFailed: any = null;
        let argsDefault: any = null;
        for (const item of res!.logs) {
            if (item.event === 'RedemptionPaymentFailed') {
                argsFailed = item.args;
            }
            if (item.event === 'RedemptionDefault') {
                argsDefault = item.args;
            }
        }
        // send alert
        await agentBot.runStep(orm.em);
        // check end balance
        const endBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
        const endBalanceAgent = await context.wnat.balanceOf(agentBot.agent.agentVault.address);
        // asserts
        assert(argsFailed.failureReason, "not redeemer's address");
        assert(endBalanceRedeemer.sub(startBalanceRedeemer), String(argsDefault.redeemedCollateralWei));
        assert(startBalanceAgent.sub(endBalanceAgent), String(argsDefault.redeemedCollateralWei));
    });

    it("Should catch 'RedemptionPaymentBlocked' event", async () => {
        const challenger = await createTestChallenger(runner, orm.em, context, challengerAddress);
        // create test actors
        await createTestActors(ownerAddress, minterAddress, redeemerAddress, minterUnderlying, redeemerUnderlying);
        await challenger.runStep(orm.em);
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 50);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // perform redemption
        const [reqs] = await redeemer.requestRedemption(2);
        const rdReq = reqs[0];
        // create redemption entity
        await agentBot.handleEvents(orm.em);
        const redemption = await agentBot.findRedemption(orm.em, rdReq.requestId);
        expect(redemption.state).eq(AgentRedemptionState.STARTED);
        // pay for redemption - payment blocked
        const paymentAmount = rdReq.valueUBA.sub(rdReq.feeUBA);
        const txHash = await context.wallet.addTransaction(agentBot.agent.underlyingAddress, rdReq.paymentAddress, paymentAmount, rdReq.paymentReference, { status: TX_BLOCKED } as MockTransactionOptionsWithFee);
        chain.mine(chain.finalizationBlocks + 1);
        // mark redemption as paid
        redemption.txHash = txHash;
        redemption.state = AgentRedemptionState.PAID;
        // run step
        await agentBot.runStep(orm.em);
        await agentBot.runStep(orm.em);
        // catch 'RedemptionPaymentBlocked' event
        await challenger.runStep(orm.em);
        // send notification
        const spy = chai.spy.on(agentBot.notifier, 'sendRedemptionFailedOrBlocked');
        await agentBot.runStep(orm.em);
        expect(spy).to.have.been.called.once;
    });

    it("Should perform free balance negative challenge", async () => {
        const challenger = await createTestChallenger(runner, orm.em, context, challengerAddress);
        // create test actors
        await createTestActors(ownerAddress, minterAddress, redeemerAddress, minterUnderlying, redeemerUnderlying);
        await challenger.runStep(orm.em);
        // announce and perform underlying withdrawal
        const underlyingWithdrawal = await agentBot.agent.announceUnderlyingWithdrawal();
        await agentBot.agent.performUnderlyingWithdrawal(underlyingWithdrawal, 100);
        chain.mine(chain.finalizationBlocks + 1);
        // run challenger's steps until agent's status is FULL_LIQUIDATION
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await sleep(3000);
            await challenger.runStep(orm.em);
            const agentStatus = await getAgentStatus(agentBot);
            console.log(`Challenger step ${i}, agent status = ${AgentStatus[agentStatus]}`)
            if (agentStatus === AgentStatus.FULL_LIQUIDATION) break;
        }
        // send notification
        await agentBot.runStep(orm.em);
        // check status
        const agentStatus2 = await getAgentStatus(agentBot);
        assert.equal(agentStatus2, AgentStatus.FULL_LIQUIDATION);
    });

    it("Should remove agent when agent is destroyed", async () => {
        const challenger = await createTestChallenger(runner, orm.em, context, challengerAddress);
        // create test actors
        await createTestActors(ownerAddress, minterAddress, redeemerAddress, minterUnderlying, redeemerUnderlying);
        await challenger.runStep(orm.em);
        assert.equal(challenger.state.agents.size, 1);
        // check agent status
        const status = await getAgentStatus(agentBot);
        assert.equal(status, AgentStatus.NORMAL);
        // exit available
        await agentBot.agent.exitAvailable();
        // announce agent destruction
        await agentBot.agent.announceDestroy();
        // check agent status
        const status2 = await getAgentStatus(agentBot);
        assert.equal(status2, AgentStatus.DESTROYING);
        // increase time
        const settings = await context.assetManager.getSettings();
        await time.increase(Number(settings.withdrawalWaitMinSeconds) * 2);
        // agent destruction
        await agentBot.agent.destroy();
        await agentBot.runStep(orm.em);
        const agentBotEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.agentVault.address, } as FilterQuery<AgentEntity>);
        assert.equal(agentBotEnt.active, false);
        // handle destruction
        await challenger.runStep(orm.em);
        assert.equal(challenger.state.agents.size, 0);
    });

    it("Should not handle transaction confirmed - no tracked agent", async () => {
        // create test actors
        await createTestActors(ownerAddress, minterAddress, redeemerAddress, minterUnderlying, redeemerUnderlying);
        // create challenger
        const challenger = await createTestChallenger(runner, orm.em, context, accounts[70]);
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 50);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // perform redemption
        const [reqs] = await redeemer.requestRedemption(2);
        const rdReq = reqs[0];
        // run agent's steps until redemption process is finished
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await agentBot.runStep(orm.em);
            // check if redemption is done
            orm.em.clear();
            const redemption = await agentBot.findRedemption(orm.em, rdReq.requestId);
            console.log(`Agent step ${i}, state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.DONE) break;
        }
        const agentStatus1 = await getAgentStatus(agentBot);
        assert.equal(agentStatus1, AgentStatus.NORMAL);
        //
        await challenger.runStep(orm.em);
        assert.equal(challenger.state.agents.size, 0);
    });

});