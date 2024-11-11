import { time } from "@openzeppelin/test-helpers";
import { assert, expect, spy, use } from "chai";
import spies from "chai-spies";
import { ORM } from "../../src/config/orm";
import { AgentRedemptionState } from "../../src/entities/common";
import { AgentStatus } from "../../src/fasset/AssetManagerTypes";
import { PaymentReference } from "../../src/fasset/PaymentReference";
import { MockChain } from "../../src/mock/MockChain";
import { TrackedState } from "../../src/state/TrackedState";
import { attestationProved } from "../../src/underlying-chain/AttestationHelper";
import { TX_BLOCKED } from "../../src/underlying-chain/interfaces/IBlockChain";
import { IBlockChainWallet, SpentReceivedObject, TransactionOptionsWithFee, UTXO } from "../../src/underlying-chain/interfaces/IBlockChainWallet";
import { proveAndUpdateUnderlyingBlock } from "../../src/utils/fasset-helpers";
import { sleep, toBN } from "../../src/utils/helpers";
import { artifacts, web3 } from "../../src/utils/web3";
import { testChainInfo } from "../../test/test-utils/TestChainInfo";
import { createTestOrm } from "../../test/test-utils/create-test-orm";
import { fundUnderlying, performRedemptionPayment } from "../../test/test-utils/test-helpers";
import { TestAssetBotContext, createTestAssetContext } from "../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../test-utils/hardhat-test-helpers";
import { assertWeb3DeepEqual, createCRAndPerformMintingAndRunSteps, createTestAgentBotAndMakeAvailable, createTestChallenger, createTestLiquidator, createTestMinter, createTestRedeemer, getAgentStatus, runWithManualSCFinalization, updateAgentBotUnderlyingBlockProof } from "../test-utils/helpers";
use(spies);

const IERC20 = artifacts.require("IERC20");
const underlyingAddress: string = "UNDERLYING_ADDRESS";

describe("Challenger tests", () => {
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
    });

    async function initialize() {
        orm = await createTestOrm();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        const lastBlock = await web3.eth.getBlockNumber();
        state = new TrackedState(context, lastBlock);
        await state.initialize();
        chain = context.blockchainIndexer.chain;
        return { orm, context, state, chain };
    }

    beforeEach(async () => {
        ({ orm, context, chain, state } = await loadFixtureCopyVars(initialize));
    });

    it("Should challenge illegal payment", async () => {
        const challenger = await createTestChallenger(context, challengerAddress, state);
        const spyChlg = spy.on(challenger, "illegalTransactionChallenge");
        // create test actors
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        await challenger.runStep();
        // faucet underlying
        const underlyingBalance = toBN(1000000000);
        await fundUnderlying(context, agentBot.agent.underlyingAddress, underlyingBalance);
        // perform illegal payment
        const underlyingAddress = "someUnderlyingAddress";
        await agentBot.agent.performPayment(underlyingAddress, underlyingBalance);
        // run challenger's steps until agent's status is FULL_LIQUIDATION
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await sleep(3000);
            await challenger.runStep();
            const agentStatus = await getAgentStatus(agentBot);
            console.log(`Challenger step ${i}, agent status = ${AgentStatus[agentStatus]}`);
            if (agentStatus === AgentStatus.FULL_LIQUIDATION) break;
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        // send notification
        await agentBot.runStep(orm.em);
        // check status
        const agentStatus = await getAgentStatus(agentBot);
        assert.equal(agentStatus, AgentStatus.FULL_LIQUIDATION);
        expect(spyChlg).to.have.been.called.once;
    });

    it("Should challenge illegal payment - reference for nonexisting redemption", async () => {
        const challenger = await createTestChallenger(context, challengerAddress, state);
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
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        const agentStatus = await getAgentStatus(agentBot);
        assert.equal(agentStatus, AgentStatus.FULL_LIQUIDATION);
        expect(spyChlg).to.have.been.called.once;
    });

    it("Should challenge double payment", async () => {
        const challenger = await createTestChallenger(context, challengerAddress, state);
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
        // update underlying block
        await proveAndUpdateUnderlyingBlock(context.attestationProvider, context.assetManager, ownerAddress);
        // perform redemption
        const [reqs] = await redeemer.requestRedemption(2);
        const rdReq = reqs[0];
        // run agent's steps until redemption process is finished
        for (let i = 0; ; i++) {
            await updateAgentBotUnderlyingBlockProof(context, agentBot);
            await time.advanceBlock();
            chain.mine();
            await runWithManualSCFinalization(context, true, () => agentBot.runStep(orm.em));
            // check if redemption is done
            orm.em.clear();
            const redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
            console.log(`Agent step ${i}, state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.REQUESTED_PROOF) break;
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        const agentStatus1 = await getAgentStatus(agentBot);
        assert.equal(agentStatus1, AgentStatus.NORMAL);
        // fund and repeat the same payment
        const paymentAmount = reqs[0].valueUBA.sub(reqs[0].feeUBA);
        await fundUnderlying(context, agentBot.agent.underlyingAddress, paymentAmount);
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
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        // send notification
        await agentBot.runStep(orm.em);
        const agentStatus2 = await getAgentStatus(agentBot);
        assert.equal(agentStatus2, AgentStatus.FULL_LIQUIDATION);
        expect(spyChlg).to.have.been.called.once;
    });

    it("Should challenge double payment - announced withdrawal", async () => {
        const challenger = await createTestChallenger(context, challengerAddress, state);
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
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        const agentStatus2 = await getAgentStatus(agentBot);
        assert.equal(agentStatus2, AgentStatus.FULL_LIQUIDATION);
        expect(spyChlg).to.have.been.called.once;
        const spyAgent = spy.on(agentBot.notifier, "sendFullLiquidationAlert");
        await agentBot.runStep(orm.em);
        expect(spyAgent).to.have.been.called.once;
    });

    it("Should challenge double payment - reference for already confirmed redemption", async () => {
        const challenger = await createTestChallenger(context, challengerAddress, state);
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
        const transferFeeMillionths = await context.assetManager.transferFeeMillionths();
        const transferFee = fBalance.mul(transferFeeMillionths).divn(1e6);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // update underlying block
        await proveAndUpdateUnderlyingBlock(context.attestationProvider, context.assetManager, ownerAddress);
        // claim transfer fee
        const balanceBefore = await context.fAsset.balanceOf(redeemer.address);
        await agentBot.agent.claimAndSendTransferFee(redeemer.address);
        const balanceAfter = await context.fAsset.balanceOf(redeemer.address);
        assertWeb3DeepEqual(balanceAfter, balanceBefore.add(transferFee));
        // create redemption requests and perform redemption
        const [reqs] = await redeemer.requestRedemption(3);
        const rdReq = reqs[0];
        // run agent's steps until redemption process is finished
        for (let i = 0; ; i++) {
            await updateAgentBotUnderlyingBlockProof(context, agentBot);
            await time.advanceBlock();
            chain.mine();
            await agentBot.runStep(orm.em);
            // check if redemption is done
            orm.em.clear();
            const redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
            console.log(`Agent step ${i}, state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.DONE) break;
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        // fund and repeat the same payment (already confirmed)
        const paymentAmount = rdReq.valueUBA.sub(rdReq.feeUBA);
        await fundUnderlying(context, agentBot.agent.underlyingAddress, paymentAmount);
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
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        const agentStatus = await getAgentStatus(agentBot);
        assert.equal(agentStatus, AgentStatus.FULL_LIQUIDATION);
        expect(spyChlg).to.have.been.called.once;
    });

    it("Should challenge illegal/double payment - reference for already confirmed announced withdrawal", async () => {
        const challenger = await createTestChallenger(context, challengerAddress, state);
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
        const txHash = await agentBot.agent.performPayment(agentInfo.underlyingAddressString, toBN(agentInfo.freeUnderlyingBalanceUBA).divn(2), announce.paymentReference);
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
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        const agentStatus2 = await getAgentStatus(agentBot);
        assert.equal(agentStatus2, AgentStatus.FULL_LIQUIDATION);
        expect(spyChlg).to.have.been.called.once;
    });

    it("Should catch 'RedemptionPaymentFailed' event - failed underlying payment (not redeemer's address)", async () => {
        const challenger = await createTestChallenger(context, challengerAddress, state);
        // create test actors
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        const redeemer = await createTestRedeemer(context, redeemerAddress);
        await challenger.runStep();
        // create collateral reservation and perform minting
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 1, orm, chain);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        const transferFeeMillionths = await context.assetManager.transferFeeMillionths();
        const transferFee = fBalance.mul(transferFeeMillionths).divn(1e6);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // update underlying block
        await proveAndUpdateUnderlyingBlock(context.attestationProvider, context.assetManager, ownerAddress);
        // claim transfer fee
        const balanceBefore = await context.fAsset.balanceOf(redeemer.address);
        await agentBot.agent.claimAndSendTransferFee(redeemer.address);
        const balanceAfter = await context.fAsset.balanceOf(redeemer.address);
        assertWeb3DeepEqual(balanceAfter, balanceBefore.add(transferFee));
        // update underlying block
        await proveAndUpdateUnderlyingBlock(context.attestationProvider, context.assetManager, ownerAddress);
        // perform redemption
        const [reqs] = await redeemer.requestRedemption(1);
        const rdReq = reqs[0];
        // create redemption entity
        await agentBot.handleEvents(orm.em);
        const redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
        expect(redemption.state).eq(AgentRedemptionState.STARTED);
        // pay for redemption - wrong underlying address, also tweak redemption to trigger low underlying balance alert
        redemption.paymentAddress = minter.underlyingAddress;
        const agentBalance = await context.blockchainIndexer.chain.getBalance(agentBot.agent.underlyingAddress);
        redemption.valueUBA = toBN(agentBalance).sub(context.chainInfo.minimumAccountBalance);
        await agentBot.redemption.checkBeforeRedemptionPayment(orm.em, redemption);
        expect(redemption.state).eq(AgentRedemptionState.PAID);
        // check payment proof is available
        for (let i = 0; ; i++) {
            await updateAgentBotUnderlyingBlockProof(context, agentBot);
            await time.advanceBlock();
            chain.mine();
            await runWithManualSCFinalization(context, true, () => agentBot.runStep(orm.em));
            // check if payment proof available
            orm.em.clear();
            const redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
            console.log(`Agent step ${i}, state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.REQUESTED_PROOF) break;
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        // check start balance
        const startBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
        const startBalanceAgent = await context.wNat.balanceOf(agentBot.agent.agentVault.address);
        // confirm payment proof is available
        const fetchedRedemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
        const proof = await context.attestationProvider.obtainPaymentProof(fetchedRedemption.proofRequestRound!, fetchedRedemption.proofRequestData!);
        if (!attestationProved(proof)) assert.fail("not proved");
        const res = await context.assetManager.confirmRedemptionPayment(proof, fetchedRedemption.requestId, { from: agentBot.agent.owner.workAddress });
        // finish redemption
        await agentBot.runStep(orm.em);
        expect(fetchedRedemption.state).eq(AgentRedemptionState.DONE);
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
        const challenger = await createTestChallenger(context, challengerAddress, state);
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
        const redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
        expect(redemption.state).eq(AgentRedemptionState.STARTED);
        // pay for redemption - payment blocked
        const paymentAmount = rdReq.valueUBA.sub(rdReq.feeUBA);
        const txDbId = await context.wallet.addTransaction(agentBot.agent.underlyingAddress, rdReq.paymentAddress, paymentAmount, rdReq.paymentReference,
            { status: TX_BLOCKED } as TransactionOptionsWithFee & { status?: number });
        chain.mine(chain.finalizationBlocks + 1);
        // mark redemption as paid
        await agentBot.runInTransaction(orm.em, async em => {
            const rd = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
            rd.txDbId = txDbId;
            rd.state = AgentRedemptionState.PAID;
        })
        // run step
        const spyRedemption = spy.on(agentBot.notifier, "sendRedemptionBlocked");
        await updateAgentBotUnderlyingBlockProof(context, agentBot);
        await agentBot.runStep(orm.em);
        await agentBot.runStep(orm.em);
        // catch 'RedemptionPaymentBlocked' event
        await challenger.runStep();
        // send notification
        await agentBot.runStep(orm.em);
        expect(spyRedemption).to.have.been.called.once;
    });

    it("Should perform free balance negative challenge", async () => {
        const challenger = await createTestChallenger(context, challengerAddress, state);
        // create test actors
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2, orm, chain);
        await challenger.runStep();
        const underlyingBalanceUBA = toBN((await agentBot.agent.getAgentInfo()).underlyingBalanceUBA).sub(context.chainInfo.minimumAccountBalance);
        // announce and perform underlying withdrawal
        const underlyingWithdrawal = await agentBot.agent.announceUnderlyingWithdrawal();
        await agentBot.agent.performPayment(underlyingAddress, underlyingBalanceUBA, underlyingWithdrawal.paymentReference);
        // fund and perform payment
        await fundUnderlying(context, agentBot.agent.underlyingAddress, underlyingBalanceUBA);
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
            assert.isBelow(i, 50);  // prevent infinite loops
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
        const faultyContext = await createTestAssetContext(accounts[0], testChainInfo.xrp, { useAlwaysFailsProver: true });
        const challenger = await createTestChallenger(faultyContext, challengerAddress, state);
        await challenger.runStep();
        const underlyingBalanceUBA = toBN((await agentBot.agent.getAgentInfo()).underlyingBalanceUBA).sub(context.chainInfo.minimumAccountBalance);
        // announce and perform underlying withdrawal
        const underlyingWithdrawal = await agentBot.agent.announceUnderlyingWithdrawal();
        await agentBot.agent.performPayment(underlyingAddress, underlyingBalanceUBA, underlyingWithdrawal.paymentReference);
        // fund first and perform payment
        await fundUnderlying(context, agentBot.agent.underlyingAddress, underlyingBalanceUBA);
        await agentBot.agent.performPayment("underlying", underlyingBalanceUBA);
        chain.mine(chain.finalizationBlocks + 1);
        await challenger.runStep();
        // check status
        const agentStatus2 = await getAgentStatus(agentBot);
        assert.equal(agentStatus2, AgentStatus.NORMAL);
    });

    it("Coinspect - Will not challenge negative balance with multipleUTXOs", async () => {
        const challenger = await createTestChallenger(context, challengerAddress, state);
        // create test actors
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2, orm, chain);
        await challenger.runStep();
        const underlyingBalanceUBA = (await agentBot.agent.getAgentInfo()).underlyingBalanceUBA;
        // announce and perform underlying withdrawal
        const underlyingWithdrawal = await agentBot.agent.announceUnderlyingWithdrawal();
        const spenderAddr = agentBot.agent.underlyingAddress;
        const agentUnderlyingAddr = underlyingAddress;
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
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        // send notification
        await agentBot.runStep(orm.em);
        // check status
        const agentStatus2 = await getAgentStatus(agentBot);
        assert.equal(agentStatus2, AgentStatus.FULL_LIQUIDATION);
    });

    it("Coinspect - Underflow upon redemption payment", async () => {
        const challenger = await createTestChallenger(context, challengerAddress, state);
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
        // update underlying block
        await proveAndUpdateUnderlyingBlock(context.attestationProvider, context.assetManager, ownerAddress);
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
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        // send notification
        await agentBot.runStep(orm.em);
        const agentStatus2 = await getAgentStatus(agentBot);
        assert.equal(agentStatus2, AgentStatus.FULL_LIQUIDATION);
        expect(spyChlg).to.have.been.called.twice; // gets called once for each transaction
    });

    it("Should liquidate agent if in full liquidation", async () => {
        const challenger = await createTestChallenger(context, challengerAddress, state);
        const lastBlock = await web3.eth.getBlockNumber();
        const liqState = new TrackedState(context, lastBlock);
        await liqState.initialize();
        const liquidator = await createTestLiquidator(context, liquidatorAddress, liqState);
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
        const transferFeeMillionths = await context.assetManager.transferFeeMillionths();
        const transferFee = fBalance.mul(transferFeeMillionths).divn(1e6);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // update underlying block
        await proveAndUpdateUnderlyingBlock(context.attestationProvider, context.assetManager, ownerAddress);
        // claim transfer fee
        const balanceBefore = await context.fAsset.balanceOf(redeemer.address);
        await agentBot.agent.claimAndSendTransferFee(redeemer.address);
        const balanceAfter = await context.fAsset.balanceOf(redeemer.address);
        assertWeb3DeepEqual(balanceAfter, balanceBefore.add(transferFee));
        // update underlying block
        await proveAndUpdateUnderlyingBlock(context.attestationProvider, context.assetManager, ownerAddress);
        // create redemption requests and perform redemption
        const [reqs] = await redeemer.requestRedemption(3);
        const rdReq = reqs[0];
        // run agent's steps until redemption process is finished
        for (let i = 0; ; i++) {
            await updateAgentBotUnderlyingBlockProof(context, agentBot);
            await time.advanceBlock();
            chain.mine();
            await agentBot.runStep(orm.em); // check if redemption is done orm.em.clear();
            const redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
            console.log(`Agent step ${i}, state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.DONE) break;
            assert.isBelow(i, 50);  // prevent infinite loops
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
            assert.isBelow(i, 50);  // prevent infinite loops
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
