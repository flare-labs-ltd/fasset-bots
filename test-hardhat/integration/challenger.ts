import { time } from "@openzeppelin/test-helpers";
import { assert } from "chai";
import { ORM } from "../../src/config/orm";
import { MockChain } from "../../src/mock/MockChain";
import { sleep, toBN } from "../../src/utils/helpers";
import { artifacts, web3 } from "../../src/utils/web3";
import { TestAssetBotContext, createTestAssetContext } from "../test-utils/create-test-asset-context";
import { testChainInfo } from "../../test/test-utils/TestChainInfo";
import { PaymentReference } from "../../src/fasset/PaymentReference";
import { AgentRedemptionState } from "../../src/entities/agent";
import {
    createTestAgentBotAndMakeAvailable,
    createCRAndPerformMintingAndRunSteps,
    createTestChallenger,
    createTestMinter,
    createTestRedeemer,
    getAgentStatus,
} from "../test-utils/helpers";
import { TrackedState } from "../../src/state/TrackedState";
import { TransactionOptionsWithFee, UTXO, SpentReceivedObject, IBlockChainWallet } from "../../src/underlying-chain/interfaces/IBlockChainWallet";
import { TX_BLOCKED } from "../../src/underlying-chain/interfaces/IBlockChain";
import { overrideAndCreateOrm } from "../../src/mikro-orm.config";
import { createTestOrmOptions } from "../../test/test-utils/test-bot-config";
import spies from "chai-spies";
import { expect, spy, use } from "chai";
import { AgentStatus } from "../../src/fasset/AssetManagerTypes";
import { performRedemptionPayment } from "../../test/test-utils/test-helpers";
import { attestationProved } from "../../src/underlying-chain/AttestationHelper";
import { createTestLiquidator } from "../test-utils/helpers";
use(spies);

type MockTransactionOptionsWithFee = TransactionOptionsWithFee & { status?: number };

const IERC20 = artifacts.require("IERC20");
const underlyingAddress: string = "UNDERLYING_ADDRESS";

describe("Challenger tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let minter2Address: string;
    let redeemerAddress: string;
    let challengerAddress: string;
    let liquidatorAddress: string;
    let chain: MockChain;
    let state: TrackedState;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        ownerAddress = accounts[3];
        minterAddress = accounts[4];
        redeemerAddress = accounts[5];
        challengerAddress = accounts[6];
        liquidatorAddress = accounts[7];
        minter2Address = accounts[8];
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: "recreate", type: "sqlite" }));
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        const lastBlock = await web3.eth.getBlockNumber();
        state = new TrackedState(context, lastBlock);
        await state.initialize();
        chain = context.blockchainIndexer.chain;
        // chain tunning
        chain.finalizationBlocks = context.blockchainIndexer.finalizationBlocks = 0;
        chain.secondsPerBlock = context.blockchainIndexer.secondsPerBlock = 1;
    });

    it("Should challenge illegal payment", async () => {
        const challenger = await createTestChallenger(challengerAddress, state);
        const spyChlg = spy.on(challenger, "illegalTransactionChallenge");
        // create test actors
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        await challenger.runStep();
        // create collateral reservation and perform minting
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2, orm, chain);
        // perform illegal payment
        const agentInfo = await agentBot.agent.getAgentInfo();
        await agentBot.agent.performPayment(agentInfo.underlyingAddressString, toBN(agentInfo.mintedUBA).divn(2));
        // run challenger's steps until agent's status is FULL_LIQUIDATION
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await sleep(3000);
            await challenger.runStep();
            const agentStatus = await getAgentStatus(agentBot);
            console.log(`Challenger step ${i}, agent status = ${AgentStatus[agentStatus]}`);
            if (agentStatus === AgentStatus.FULL_LIQUIDATION) break;
        }
        // send notification
        await agentBot.runStep(orm.em);
        // check status
        const agentStatus = await getAgentStatus(agentBot);
        assert.equal(agentStatus, AgentStatus.FULL_LIQUIDATION);
        expect(spyChlg).to.have.been.called.once;
    });

    it("Should challenge illegal payment - reference for nonexisting redemption", async () => {
        const challenger = await createTestChallenger(challengerAddress, state);
        const spyChlg = spy.on(challenger, "illegalTransactionChallenge");
        // create test actors
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        await challenger.runStep();
        // create collateral reservation and perform minting
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2, orm, chain);
        // perform illegal payment
        const agentInfo = await agentBot.agent.getAgentInfo();
        await agentBot.agent.performPayment(agentInfo.underlyingAddressString, toBN(agentInfo.mintedUBA).divn(2), PaymentReference.redemption(15));
        // run challenger's steps until agent's status is FULL_LIQUIDATION
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await sleep(3000);
            await challenger.runStep();
            const agentStatus = await getAgentStatus(agentBot);
            console.log(`Challenger step ${i}, agent status = ${AgentStatus[agentStatus]}`);
            if (agentStatus === AgentStatus.FULL_LIQUIDATION) break;
        }
        const agentStatus = await getAgentStatus(agentBot);
        assert.equal(agentStatus, AgentStatus.FULL_LIQUIDATION);
        expect(spyChlg).to.have.been.called.once;
    });

    it("Should challenge double payment", async () => {
        const challenger = await createTestChallenger(challengerAddress, state);
        const spyChlg = spy.on(challenger, "doublePaymentChallenge");
        // create test actors
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        const redeemer = await createTestRedeemer(context, redeemerAddress);
        await challenger.runStep();
        // create collateral reservation and perform minting
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 3, orm, chain);
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
            if (redemption.state === AgentRedemptionState.REQUESTED_PROOF) break;
        }
        const agentStatus1 = await getAgentStatus(agentBot);
        assert.equal(agentStatus1, AgentStatus.NORMAL);
        // repeat the same payment
        await performRedemptionPayment(agentBot.agent, reqs[0]);
        // run challenger's steps until agent's status is FULL_LIQUIDATION
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await sleep(3000);
            await challenger.runStep();
            const agentStatus = await getAgentStatus(agentBot);
            console.log(`Challenger step ${i}, agent status = ${AgentStatus[agentStatus]}`);
            if (agentStatus === AgentStatus.FULL_LIQUIDATION) break;
        }
        // send notification
        await agentBot.runStep(orm.em);
        const agentStatus2 = await getAgentStatus(agentBot);
        assert.equal(agentStatus2, AgentStatus.FULL_LIQUIDATION);
        expect(spyChlg).to.have.been.called.once;
    });

    it("Should challenge double payment - announced withdrawal", async () => {
        const challenger = await createTestChallenger(challengerAddress, state);
        const spyChlg = spy.on(challenger, "doublePaymentChallenge");
        // create test actors
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        await challenger.runStep();
        // create collateral reservation and perform minting
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 3, orm, chain);
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
            await challenger.runStep();
            const agentStatus = await getAgentStatus(agentBot);
            console.log(`Challenger step ${i}, agent status = ${AgentStatus[agentStatus]}`);
            if (agentStatus === AgentStatus.FULL_LIQUIDATION) break;
        }
        const agentStatus2 = await getAgentStatus(agentBot);
        assert.equal(agentStatus2, AgentStatus.FULL_LIQUIDATION);
        expect(spyChlg).to.have.been.called.once;
        const spyAgent = spy.on(agentBot.notifier, "sendFullLiquidationAlert");
        await agentBot.runStep(orm.em);
        expect(spyAgent).to.have.been.called.once;
    });

    it("Should challenge double payment - reference for already confirmed redemption", async () => {
        const challenger = await createTestChallenger(challengerAddress, state);
        const spyChlg = spy.on(challenger, "doublePaymentChallenge");
        // create test actors
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        const redeemer = await createTestRedeemer(context, redeemerAddress);
        await challenger.runStep();
        // create collateral reservation and perform minting
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 3, orm, chain);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // create redemption requests and perform redemption
        const [reqs] = await redeemer.requestRedemption(3);
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
        // repeat the same payment (already confirmed)
        await performRedemptionPayment(agentBot.agent, rdReq);
        // run challenger's and agent's steps until agent's status is FULL_LIQUIDATION
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await sleep(3000);
            await challenger.runStep();
            await agentBot.runStep(orm.em);
            const agentStatus = await getAgentStatus(agentBot);
            console.log(`Challenger step ${i}, agent status = ${AgentStatus[agentStatus]}`);
            if (agentStatus === AgentStatus.FULL_LIQUIDATION) break;
        }
        const agentStatus = await getAgentStatus(agentBot);
        assert.equal(agentStatus, AgentStatus.FULL_LIQUIDATION);
        expect(spyChlg).to.have.been.called.once;
    });

    it("Should challenge illegal/double payment - reference for already confirmed announced withdrawal", async () => {
        const challenger = await createTestChallenger(challengerAddress, state);
        const spyChlg = spy.on(challenger, "doublePaymentChallenge");
        // create test actors
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        await challenger.runStep();
        // create collateral reservation and perform minting
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 3, orm, chain);
        const agentInfo = await agentBot.agent.getAgentInfo();
        // announce underlying withdrawal
        const announce = await agentBot.agent.announceUnderlyingWithdrawal();
        const txHash = await agentBot.agent.performPayment(
            agentInfo.underlyingAddressString,
            toBN(agentInfo.freeUnderlyingBalanceUBA).divn(2),
            announce.paymentReference
        );
        chain.mine(chain.finalizationBlocks + 1);
        const skipTime = (await context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds;
        await time.increase(skipTime);
        // confirm underlying withdrawal
        await agentBot.agent.confirmUnderlyingWithdrawal(txHash);
        // repeat the same payment
        await agentBot.agent.performPayment(agentInfo.underlyingAddressString, toBN(agentInfo.freeUnderlyingBalanceUBA).divn(2), announce.paymentReference);
        // run challenger's steps until agent's status is FULL_LIQUIDATION
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await sleep(3000);
            await challenger.runStep();
            const agentStatus = await getAgentStatus(agentBot);
            console.log(`Challenger step ${i}, agent status = ${AgentStatus[agentStatus]}`);
            if (agentStatus === AgentStatus.FULL_LIQUIDATION) break;
        }
        const agentStatus2 = await getAgentStatus(agentBot);
        assert.equal(agentStatus2, AgentStatus.FULL_LIQUIDATION);
        expect(spyChlg).to.have.been.called.once;
    });

    it("Should catch 'RedemptionPaymentFailed' event - failed underlying payment (not redeemer's address)", async () => {
        const challenger = await createTestChallenger(challengerAddress, state);
        // create test actors
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        const redeemer = await createTestRedeemer(context, redeemerAddress);
        await challenger.runStep();
        // create collateral reservation and perform minting
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 1, orm, chain);
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
        const agentBalance = await context.blockchainIndexer.chain.getBalance(agentBot.agent.underlyingAddress);
        redemption.valueUBA = toBN(agentBalance);
        chain.requiredFee = toBN(redemption.feeUBA);
        await agentBot.payForRedemption(redemption);
        expect(redemption.state).eq(AgentRedemptionState.PAID);
        // check payment proof is available
        await agentBot.nextRedemptionStep(orm.em, redemption.id);
        expect(redemption.state).eq(AgentRedemptionState.REQUESTED_PROOF);
        // check start balance
        const startBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
        const startBalanceAgent = await context.wNat.balanceOf(agentBot.agent.agentVault.address);
        // confirm payment proof is available
        const proof = await context.attestationProvider.obtainPaymentProof(redemption.proofRequestRound!, redemption.proofRequestData!);
        if (!attestationProved(proof)) assert.fail("not proved");
        const res = await context.assetManager.confirmRedemptionPayment(proof, redemption.requestId, { from: agentBot.agent.ownerAddress });
        // finish redemption
        await agentBot.runStep(orm.em);
        expect(redemption.state).eq(AgentRedemptionState.DONE);
        // catch 'RedemptionPaymentFailed' event
        await challenger.runStep();
        let argsFailed: any = null;
        let argsDefault: any = null;
        for (const item of res!.logs) {
            if (item.event === "RedemptionPaymentFailed") {
                argsFailed = item.args;
            }
            if (item.event === "RedemptionDefault") {
                argsDefault = item.args;
            }
        }
        // send alert
        await agentBot.runStep(orm.em);
        // check end balance
        const endBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
        const endBalanceAgent = await context.wNat.balanceOf(agentBot.agent.agentVault.address);
        // asserts
        assert(argsFailed.failureReason, "not redeemer's address");
        assert(endBalanceRedeemer.sub(startBalanceRedeemer), String(argsDefault.redeemedCollateralWei));
        assert(startBalanceAgent.sub(endBalanceAgent), String(argsDefault.redeemedCollateralWei));
    });

    it("Should catch 'RedemptionPaymentBlocked' event", async () => {
        const challenger = await createTestChallenger(challengerAddress, state);
        // create test actors
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        const redeemer = await createTestRedeemer(context, redeemerAddress);
        await challenger.runStep();
        // create collateral reservation and perform minting
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 3, orm, chain);
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
        const txHash = await context.wallet.addTransaction(agentBot.agent.underlyingAddress, rdReq.paymentAddress, paymentAmount, rdReq.paymentReference, {
            status: TX_BLOCKED,
        } as TransactionOptionsWithFee & { status?: number });
        chain.mine(chain.finalizationBlocks + 1);
        // mark redemption as paid
        redemption.txHash = txHash;
        redemption.state = AgentRedemptionState.PAID;
        // run step
        await agentBot.runStep(orm.em);
        await agentBot.runStep(orm.em);
        // catch 'RedemptionPaymentBlocked' event
        await challenger.runStep();
        // send notification
        const spyRedemption = spy.on(agentBot.notifier, "sendRedemptionFailedOrBlocked");
        await agentBot.runStep(orm.em);
        expect(spyRedemption).to.have.been.called.once;
    });

    it("Should perform free balance negative challenge", async () => {
        const challenger = await createTestChallenger(challengerAddress, state);
        // create test actors
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2, orm, chain);
        await challenger.runStep();
        const underlyingBalanceUBA = (await agentBot.agent.getAgentInfo()).underlyingBalanceUBA;
        // announce and perform underlying withdrawal
        const underlyingWithdrawal = await agentBot.agent.announceUnderlyingWithdrawal();
        await agentBot.agent.performUnderlyingWithdrawal(underlyingWithdrawal.paymentReference, underlyingBalanceUBA, underlyingAddress);
        await agentBot.agent.performPayment("underlying", underlyingBalanceUBA);
        chain.mine(chain.finalizationBlocks + 1);
        // run challenger's steps until agent's status is FULL_LIQUIDATION
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await sleep(3000);
            await challenger.runStep();
            const agentStatus = await getAgentStatus(agentBot);
            console.log(`Challenger step ${i}, agent status = ${AgentStatus[agentStatus]}`);
            if (agentStatus === AgentStatus.FULL_LIQUIDATION) break;
        }
        // send notification
        await agentBot.runStep(orm.em);
        // check status
        const agentStatus2 = await getAgentStatus(agentBot);
        assert.equal(agentStatus2, AgentStatus.FULL_LIQUIDATION);
    });

    it("Should not perform free balance negative challenge - attestation helper error", async () => {
        // create test actors
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2, orm, chain);
        // check status
        const agentStatus1 = await getAgentStatus(agentBot);
        assert.equal(agentStatus1, AgentStatus.NORMAL);
        const faultyContext = await createTestAssetContext(accounts[0], testChainInfo.xrp, undefined, undefined, undefined, true);
        const faultyState = state;
        faultyState.context.attestationProvider = faultyContext.attestationProvider;
        const challenger = await createTestChallenger(challengerAddress, faultyState);
        await challenger.runStep();
        const underlyingBalanceUBA = (await agentBot.agent.getAgentInfo()).underlyingBalanceUBA;
        // announce and perform underlying withdrawal
        const underlyingWithdrawal = await agentBot.agent.announceUnderlyingWithdrawal();
        await agentBot.agent.performUnderlyingWithdrawal(underlyingWithdrawal.paymentReference, underlyingBalanceUBA, underlyingAddress);
        await agentBot.agent.performPayment("underlying", underlyingBalanceUBA);
        chain.mine(chain.finalizationBlocks + 1);
        await challenger.runStep();
        // check status
        const agentStatus2 = await getAgentStatus(agentBot);
        assert.equal(agentStatus2, AgentStatus.NORMAL);
    });

    it("Coinspect - Will not challenge negative balance with multipleUTXOs", async () => {
        const challenger = await createTestChallenger(challengerAddress, state);
        // create test actors
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2, orm, chain);
        await challenger.runStep();
        const underlyingBalanceUBA = (await agentBot.agent.getAgentInfo()).underlyingBalanceUBA;
        // announce and perform underlying withdrawal
        const underlyingWithdrawal = await agentBot.agent.announceUnderlyingWithdrawal();
        let spenderAddr = agentBot.agent.underlyingAddress;
        let agentUnderlyingAddr = underlyingAddress;
        const fistUTXOAmt = toBN(underlyingBalanceUBA).div(toBN(1000));
        const spentUTXOs: UTXO[] = [
            { value: fistUTXOAmt }, // UTXO 1
            { value: toBN(underlyingBalanceUBA).sub(fistUTXOAmt) }, // UTXO 2
        ];
        // Using This UTXO would trigger the negative underlying free balance challenge
        const spent: SpentReceivedObject = { [spenderAddr]: spentUTXOs };
        const received1: SpentReceivedObject = { [agentUnderlyingAddr]: [{ value: underlyingBalanceUBA }] };
        // Perform payment with multiple UTXOs
        console.log("\nPAYING....");
        await (agentBot.agent.wallet as IBlockChainWallet).addMultiTransaction(spent, received1, underlyingWithdrawal.paymentReference);
        chain.mine(chain.finalizationBlocks + 1);
        // run challenger's steps until agent's status is FULL_LIQUIDATION
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await sleep(3000);
            await challenger.runStep();
            const agentStatus = await getAgentStatus(agentBot);
            console.log(`Challenger step ${i}, agent status = ${AgentStatus[agentStatus]}`);
            if (agentStatus === AgentStatus.FULL_LIQUIDATION) break;
        }
        // send notification
        await agentBot.runStep(orm.em);
        // check status
        const agentStatus2 = await getAgentStatus(agentBot);
        assert.equal(agentStatus2, AgentStatus.FULL_LIQUIDATION);
    });

    it("Coinspect - Underflow upon redemption payment", async () => {
        const challenger = await createTestChallenger(challengerAddress, state);
        const spyChlg = spy.on(challenger, "freeBalanceNegativeChallenge");
        // create test actors
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        const redeemer = await createTestRedeemer(context, redeemerAddress);
        await challenger.runStep();
        // create collateral reservation and perform minting
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 3, orm, chain);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // perform redemption
        const [reqs] = await redeemer.requestRedemption(2);
        // make the redemption payment
        const paymentAmount = reqs[0].valueUBA.sub(reqs[0].feeUBA);
        const spentUTXOs: UTXO[] = [
            { value: toBN(1) }, // UTXO 1
            { value: toBN(paymentAmount).mul(toBN(2)) }, // UTXO 2
        ];
        const spenderAddr = agentBot.agent.underlyingAddress;
        const spent: SpentReceivedObject = { [spenderAddr]: spentUTXOs };
        const received1: SpentReceivedObject = { [reqs[0].paymentAddress]: [{ value: toBN(paymentAmount).mul(toBN(2)).add(toBN(1)) }] };
        // Perform payment with multiple UTXOs
        console.log("\nPAYING....");
        await agentBot.agent.wallet.addMultiTransaction(spent, received1, reqs[0].paymentReference);
        chain.mine(chain.finalizationBlocks + 1);
        const agentStatus1 = await getAgentStatus(agentBot);
        assert.equal(agentStatus1, AgentStatus.NORMAL);
        // run challenger's steps until agent's status is FULL_LIQUIDATION
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await sleep(3000);
            await challenger.runStep();
            const agentStatus = await getAgentStatus(agentBot);
            console.log(`Challenger step ${i}, agent status = ${AgentStatus[agentStatus]}`);
            if (agentStatus === AgentStatus.FULL_LIQUIDATION) break;
        }
        // send notification
        await agentBot.runStep(orm.em);
        const agentStatus2 = await getAgentStatus(agentBot);
        assert.equal(agentStatus2, AgentStatus.FULL_LIQUIDATION);
        expect(spyChlg).to.have.been.called.twice; // gets called once for each transaction
    });

    it("Should liquidate agent if in full liquidation", async () => {
        const challenger = await createTestChallenger(challengerAddress, state);
        const lastBlock = await web3.eth.getBlockNumber();
        const liqState = new TrackedState(context, lastBlock);
        await liqState.initialize();
        const liquidator = await createTestLiquidator(liquidatorAddress, liqState);
        const spyChlg = spy.on(challenger, "doublePaymentChallenge"); // create test actors
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const poolCollateralToken = await IERC20.at((await agentBot.agent.getPoolCollateral()).token);
        const minter = await createTestMinter(context, minterAddress, chain);
        const minter2 = await createTestMinter(context, minter2Address, chain);
        const redeemer = await createTestRedeemer(context, redeemerAddress);
        await challenger.runStep();

        // create collateral reservation and perform minting
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 3, orm, chain);
        // Generate balance in funder minter
        await createCRAndPerformMintingAndRunSteps(minter2, agentBot, 3, orm, chain);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // create redemption requests and perform redemption
        const [reqs] = await redeemer.requestRedemption(3);
        const rdReq = reqs[0];
        // run agent's steps until redemption process is finished
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await agentBot.runStep(orm.em); // check if redemption is done orm.em.clear();
            const redemption = await agentBot.findRedemption(orm.em, rdReq.requestId);
            console.log(`Agent step ${i}, state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.DONE) break;
        }

        // repeat the same payment (already confirmed)
        await performRedemptionPayment(agentBot.agent, rdReq);
        // run challenger's and agent's steps until agent's status is FULL_LIQUIDATION
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await sleep(3000);
            await challenger.runStep();
            await agentBot.runStep(orm.em);
            const agentStatus = await getAgentStatus(agentBot);
            console.log(`Challenger step ${i}, agent status = ${AgentStatus[agentStatus]}`);
            if (agentStatus === AgentStatus.FULL_LIQUIDATION) break;
        }
        const agentStatus = await getAgentStatus(agentBot);
        assert.equal(agentStatus, AgentStatus.FULL_LIQUIDATION);
        expect(spyChlg).to.have.been.called.once;
        // Try to liquidate agent in full liquidation
        // liquidator "buys" f-assets
        console.log("Transferring Fassets to liquidator...");
        const funderBalance = await context.fAsset.balanceOf(minter2.address);
        await context.fAsset.transfer(liquidator.address, funderBalance, { from: minter2.address });
        // FAsset and pool collateral balance
        const fBalanceBefore = await state.context.fAsset.balanceOf(liquidatorAddress);
        const pBalanceBefore = await poolCollateralToken.balanceOf(liquidatorAddress);
        console.log("Liquidating...");
        await liquidator.runStep();
        while (liquidator.runner.runningThreads > 0) {
            await sleep(2000);
        }
        const fBalanceAfter = await state.context.fAsset.balanceOf(liquidatorAddress);
        const pBalanceAfter = await poolCollateralToken.balanceOf(liquidatorAddress);
        // The balance is changed, meaning that the agent is liquidated
        expect(pBalanceAfter.gt(pBalanceBefore)).to.be.true;
        expect(fBalanceAfter.lt(fBalanceBefore)).to.be.true;
    });
});
