import { time } from "@openzeppelin/test-helpers";
import { assert, expect } from "chai";
import { AgentBot } from "../../src/actors/AgentBot";
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
import { Challenger } from "../../src/actors/Challenger";
import { ScopedRunner } from "../../src/utils/events/ScopedRunner";
import { AgentStatus } from "../../src/state/TrackedAgentState";
import { PaymentReference } from "../../src/fasset/PaymentReference";
import { AgentRedemptionState } from "../../src/entities/agent";
import { FilterQuery } from "@mikro-orm/core/typings";
import { ProvedDH } from "../../src/underlying-chain/AttestationHelper";
import { DHPayment } from "../../src/verification/generated/attestation-hash-types";
import { ActorEntity, ActorType } from "../../src/entities/actor";
import { disableMccTraceManager } from "../utils/helpers";

const minterUnderlying: string = "MINTER_ADDRESS";
const redeemerUnderlying: string = "REDEEMER_ADDRESS";

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

    async function getAgentStatus(agentBot: AgentBot) {
        const agentInfo = await agentBot.agent.getAgentInfo();
        return Number(agentInfo.status) as AgentStatus;
    }

    async function createTestChallenger(runner: ScopedRunner, rootEm: EM, context: IAssetBotContext, challengerAddress: string) {
        const challengerEnt = await rootEm.findOne(ActorEntity, { address: challengerAddress, type: ActorType.CHALLENGER } as FilterQuery<ActorEntity>);
        if (challengerEnt) {
            return await Challenger.fromEntity(runner, context, challengerEnt);
        } else {
            return await Challenger.create(runner, rootEm, context, challengerAddress);
        }
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
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp, false);
        chain = checkedCast(context.chain, MockChain);
        // chain tunning
        chain.finalizationBlocks = 0;
        chain.secondsPerBlock = 1;
        // actors
        agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        await agentBot.agent.depositCollateral(toBNExp(100_000_000, 18));
        await agentBot.agent.makeAvailable(500, 3_0000);
        minter = await Minter.createTest(context, minterAddress, minterUnderlying, toBNExp(100_000, 18));
        chain.mine(chain.finalizationBlocks + 1);
        redeemer = await Redeemer.create(context, redeemerAddress, redeemerUnderlying);
    });

    it("Should challenge illegal payment", async () => {
        const challenger = await createTestChallenger(runner, orm.em, context, challengerAddress);
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
        const agentStatus = await getAgentStatus(agentBot);
        assert.equal(agentStatus, AgentStatus.FULL_LIQUIDATION);
    });

    it("Should challenge illegal payment - reference for nonexisting redemption", async () => {
        const challenger = await createTestChallenger(runner, orm.em, context, challengerAddress);
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
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 50);
        // transfer fassets
        const fbalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fbalance, { from: minter.address });
        // perform redemption
        const [reqs] = await redeemer.requestRedemption(2);
        const rdreq = reqs[0];
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
        const agentStatus2 = await getAgentStatus(agentBot);
        assert.equal(agentStatus2, AgentStatus.FULL_LIQUIDATION);
    });

    it("Should challenge double payment - announced withdrawal", async () => {
        const challenger = await createTestChallenger(runner, orm.em, context, challengerAddress);
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
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 50);
        // transfer fassets
        const fbalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fbalance, { from: minter.address });
        // create redemption requests and perform redemption
        const [reqs] = await redeemer.requestRedemption(10);
        const rdreq = reqs[0];
        // const txHash = await agentBot.agent.performRedemptionPayment(reqs[0]);
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
        // await agentBot.agent.confirmActiveRedemptionPayment(reqs[0], txHash);
        // repeat the same payment (already confirmed)
        await agentBot.agent.performRedemptionPayment(rdreq);
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

    it("Should challenge illegal payment - reference for already confirmed announced withdrawal", async () => {
        const challenger = await createTestChallenger(runner, orm.em, context, challengerAddress);
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
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot, 50);
        // transfer fassets
        const fbalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fbalance, { from: minter.address });
        // perform redemption
        const [reqs] = await redeemer.requestRedemption(2);
        const rdreq = reqs[0];
        // create redemption entity
        await agentBot.handleEvents(orm.em);
        const redemption = await agentBot.findRedemption(orm.em, rdreq.requestId);
        expect(redemption.state).eq(AgentRedemptionState.STARTED);
        // pay for redemption - wrong underlying address
        redemption.paymentAddress = minter.underlyingAddress;
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
        // check end balance
        const endBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
        const endBalanceAgent = await context.wnat.balanceOf(agentBot.agent.agentVault.address);
        // asserts
        assert(argsFailed.failureReason , "not redeemer's address");
        assert(endBalanceRedeemer.sub(startBalanceRedeemer), String(argsDefault.redeemedCollateralWei));
        assert(startBalanceAgent.sub(endBalanceAgent), String(argsDefault.redeemedCollateralWei));
    });

});