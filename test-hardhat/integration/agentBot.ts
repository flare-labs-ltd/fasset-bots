import { expectRevert, time } from "@openzeppelin/test-helpers";
import { assert } from "chai";
import { AgentBot } from "../../src/actors/AgentBot";
import { ORM } from "../../src/config/orm";
import { Minter } from "../../src/mock/Minter";
import { MockChain } from "../../src/mock/MockChain";
import { Redeemer } from "../../src/mock/Redeemer";
import { checkedCast, NATIVE_LOW_BALANCE, QUERY_WINDOW_SECONDS, toBN, toBNExp } from "../../src/utils/helpers";
import { web3 } from "../../src/utils/web3";
import { createTestAssetContext, TestAssetBotContext } from "../test-utils/create-test-asset-context";
import { testChainInfo } from "../../test/test-utils/TestChainInfo";
import { AgentEntity, AgentMintingState, AgentRedemptionState } from "../../src/entities/agent";
import { convertFromUSD5, createCRAndPerformMinting, createCRAndPerformMintingAndRunSteps, createTestAgentB, createTestAgentBotAndMakeAvailable, createTestMinter, createTestRedeemer, disableMccTraceManager, getAgentStatus, mintClass1ToOwner } from "../test-utils/helpers";
import { FilterQuery } from "@mikro-orm/core/typings";
import { overrideAndCreateOrm } from "../../src/mikro-orm.config";
import { createTestOrmOptions } from "../../test/test-utils/test-bot-config";
import spies from "chai-spies";
import { expect, spy, use } from "chai";
use(spies);
import BN from "bn.js";
import { artifacts } from "../../src/utils/artifacts";
import { AgentStatus } from "../../src/fasset/AssetManagerTypes";
import { FaultyNotifier } from "../test-utils/FaultyNotifier";

const IERC20 = artifacts.require('IERC20');

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
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
        ownerAddress = accounts[3];
        minterAddress = accounts[4];
        redeemerAddress = accounts[5];
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.blockchainIndexer.chain, MockChain);
        settings = await context.assetManager.getSettings();
        agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        minter = await createTestMinter(context, minterAddress, chain);
        redeemer = await createTestRedeemer(context, redeemerAddress);
        // chain tunning
        chain.finalizationBlocks = 0;
        chain.secondsPerBlock = 1;
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
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // request redemption
        const [rdReqs] = await redeemer.requestRedemption(2);
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
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
        // redeemer should now have some funds on the underlying chain
        const balance = await chain.getBalance(redeemer.underlyingAddress);
        assert.equal(String(balance), String(toBN(rdReq.valueUBA).sub(toBN(rdReq.feeUBA))));
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
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp));
        chain.mine(Number(crt.lastUnderlyingBlock));
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
        await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        // skip time so the payment will expire on underlying chain
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp));
        chain.mine(Number(crt.lastUnderlyingBlock));
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
        const mintings = await agentBot.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const mintingStarted = mintings[0];
        assert.equal(mintingStarted.state, AgentMintingState.STARTED);
        // skip time so the proof will expire in indexer
        const queryWindow = QUERY_WINDOW_SECONDS * 2;
        const queryBlock = Math.round(queryWindow / chain.secondsPerBlock);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp) + queryWindow);
        chain.mine(Number(crt.lastUnderlyingBlock) + queryBlock);
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
        const mintings = await agentBot.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const mintingStarted = mintings[0];
        assert.equal(mintingStarted.state, AgentMintingState.STARTED);
        // pay for minting
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        // skip time so the proof will expire in indexer
        const queryWindow = QUERY_WINDOW_SECONDS * 2;
        const queryBlock = Math.round(queryWindow / chain.secondsPerBlock);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp) + queryWindow);
        chain.mine(Number(crt.lastUnderlyingBlock) + queryBlock);
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
        // class1token
        const class1Token = await IERC20.at((await agentBot.agent.getClass1CollateralToken()).token);
        // perform minting
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // request redemption
        const [rdReqs] = await redeemer.requestRedemption(2);
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
        // skip time so the payment will expire on underlying chain
        chain.skipTimeTo(Number(rdReq.lastUnderlyingTimestamp));
        chain.mine(Number(rdReq.lastUnderlyingBlock));
        // redeemer requests non-payment proof
        // redeemer triggers payment default and gets paid in collateral with extra
        const startBalanceRedeemer = await class1Token.balanceOf(redeemer.address);
        const startBalanceAgent = await class1Token.balanceOf(agentBot.agent.vaultAddress);
        const res = await redeemer.redemptionPaymentDefault(rdReq);
        const endBalanceRedeemer = await class1Token.balanceOf(redeemer.address);
        const endBalanceAgent = await class1Token.balanceOf(agentBot.agent.vaultAddress);
        assert.equal(String(endBalanceRedeemer.sub(startBalanceRedeemer)), String(res.redeemedClass1CollateralWei));
        assert.equal(String(startBalanceAgent.sub(endBalanceAgent)), String(res.redeemedClass1CollateralWei));
        // check if redemption is done
        await agentBot.runStep(orm.em);
        orm.em.clear();
        const redemptionDone = await agentBot.findRedemption(orm.em, rdReq.requestId);
        assert.equal(redemptionDone.state, AgentRedemptionState.PAID);
    });

    it("Should not perform redemption - agent does not pay, time expires in indexer", async () => {
        // perform minting
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // request redemption
        const [rdReqs] = await redeemer.requestRedemption(2);
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
        // skip time so the proof will expire in indexer
        const queryWindow = QUERY_WINDOW_SECONDS * 2;
        const queryBlock = Math.round(queryWindow / chain.secondsPerBlock);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp) + queryWindow);
        chain.mine(Number(crt.lastUnderlyingBlock) + queryBlock);
        // check if redemption is done
        await agentBot.runStep(orm.em);
        orm.em.clear();
        const redemptionDone = await agentBot.findRedemption(orm.em, rdReq.requestId);
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
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // request redemption
        const [rdReqs] = await redeemer.requestRedemption(2);
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
        // agent pays
        await agentBot.runStep(orm.em);
        const redemptionPaid = await agentBot.findRedemption(orm.em, rdReq.requestId);
        assert.equal(redemptionPaid.state, AgentRedemptionState.PAID);
        // skip time so the proof will expire in indexer
        const queryWindow = QUERY_WINDOW_SECONDS * 2;
        const queryBlock = Math.round(queryWindow / chain.secondsPerBlock);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp) + queryWindow);
        chain.mine(Number(crt.lastUnderlyingBlock) + queryBlock);
        // check if redemption is done
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
        const redemptionDone = await agentBot.findRedemption(orm.em, rdReq.requestId);
        assert.equal(redemptionDone.state, AgentRedemptionState.DONE);
    });

    it("Should not perform redemption - agent does not confirm, anyone can confirm time expired on underlying", async () => {
        // class1token
        const class1CollateralToken = await agentBot.agent.getClass1CollateralToken();
        const class1Token = await IERC20.at(class1CollateralToken.token);
        // perform minting
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // request redemption
        const [rdReqs] = await redeemer.requestRedemption(2);
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
        // redemption has started and is paid
        await agentBot.runStep(orm.em);
        orm.em.clear();
        const redemptionPaid = await agentBot.findRedemption(orm.em, rdReq.requestId);
        assert.equal(redemptionPaid.state, AgentRedemptionState.PAID);
        // agent does not confirm payment
        // others can confirm redemption payment after some time
        await time.increase(settings.confirmationByOthersAfterSeconds);
        chain.mine(chain.finalizationBlocks + 1);
        const someAddress = accounts[10];
        const startBalance = await class1Token.balanceOf(someAddress);
        const startAgentBalance = await class1Token.balanceOf(agentBot.agent.vaultAddress);
        const proof = await context.attestationProvider.provePayment(redemptionPaid.txHash!, agentBot.agent.underlyingAddress, rdReq.paymentAddress);
        await context.assetManager.confirmRedemptionPayment(proof, rdReq.requestId, { from: someAddress });
        const endBalance = await class1Token.balanceOf(someAddress);
        const reward = await convertFromUSD5(settings.confirmationByOthersRewardUSD5, class1CollateralToken, settings);
        const rewardPaid = BN.min(reward, startAgentBalance);
        assert.equal(endBalance.sub(startBalance).toString(), rewardPaid.toString());
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
        // check agent status
        const status1 = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status1, AgentStatus.NORMAL);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 7), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(10, 7), 0);
        await context.assetManager.startLiquidation(agentBot.agent.vaultAddress);
        await agentBot.runStep(orm.em);
        // check agent status
        const status2 = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status2, AgentStatus.LIQUIDATION);
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
        // check agent status
        const status1 = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status1, AgentStatus.NORMAL);
        // change price
        const { 0: assetPrice } = await context.assetFtso.getCurrentPrice();
        await context.assetFtso.setCurrentPrice(assetPrice.muln(10000), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(assetPrice.muln(10000), 0);
        // start liquidation
        await context.assetManager.startLiquidation(agentBot.agent.vaultAddress);
        // check agent status
        const status2 = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status2, AgentStatus.LIQUIDATION);
        // change price back
        const { 0: assetPrice2 } = await context.assetFtso.getCurrentPrice();
        await context.assetFtso.setCurrentPrice(assetPrice2.divn(10000), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(assetPrice2.divn(10000), 0);
        // agent ends liquidation
        await context.assetManager.endLiquidation(agentBot.agent.vaultAddress, { from: agentBot.agent.ownerAddress });
        // check agent status
        const status3 = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status3, AgentStatus.NORMAL);
    });

    it("Should check collateral ratio after price changes", async () => {
        const spyTop = spy.on(agentBot, 'checkAgentForCollateralRatiosAndTopUp');
        // mock price changes
        await context.ftsoManager.mockFinalizePriceEpoch();
        // check collateral ratio after price changes
        await agentBot.runStep(orm.em);
        expect(spyTop).to.have.been.called.once;
    });

    it("Should announce agent destruction, change status from NORMAL via DESTROYING, destruct agent and set active to false", async () => {
        const agentBotEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress, } as FilterQuery<AgentEntity>);
        // check agent status
        const status = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status, AgentStatus.NORMAL);
        // redeem pool
        const agentInfo = await agentBot.agent.getAgentInfo();
        const amount = await context.wNat.balanceOf(agentInfo.collateralPool);
        const withdrawAllowedAt = await agentBot.agent.announcePoolTokenRedemption(amount);
        await time.increaseTo(withdrawAllowedAt);
        await agentBot.agent.redeemCollateralPoolTokens(amount);

        // exit available
        const exitAllowedAt = await agentBot.agent.announceExitAvailable();
        await time.increaseTo(exitAllowedAt);
        await agentBot.agent.exitAvailable();
        // announce agent destruction
        await agentBot.agent.announceDestroy();
        // check agent status
        const status2 = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status2, AgentStatus.DESTROYING);
        // increase time
        await time.increase(settings.withdrawalWaitMinSeconds * 2);
        // agent destruction
        await agentBot.agent.destroy();
        // handle destruction
        await agentBot.runStep(orm.em);
        assert.equal(agentBotEnt.active, false);
    });

    it("Should announce to close vault only if no tickets are open for that agent", async () => {
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        // perform minting
        const lots = 2;
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, lots);
        await agentBot.runStep(orm.em);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // exit available
        const exitAllowedAt = await agentBot.agent.announceExitAvailable();
        await time.increaseTo(exitAllowedAt);
        await agentBot.agent.exitAvailable();
        // close vault
        agentEnt.waitingForDestructionCleanUp = true;
        await agentBot.runStep(orm.em);
        expect(agentEnt.waitingForDestructionCleanUp).to.be.true;
        // request redemption
        const [rdReqs] = await redeemer.requestRedemption(lots);
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
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
        // clear dust
        await agentBot.agent.selfClose((await agentBot.agent.getAgentInfo()).dustUBA);
        // withdraw class1 and pool tokens
        await time.increaseTo(agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp);
        // run agent's steps until destroy is announced
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await agentBot.runStep(orm.em);
            // check if redemption is done
            orm.em.clear();
            const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
            console.log(`Agent step ${i}, waitingForDestructionCleanUp = ${agentEnt.waitingForDestructionCleanUp}`);
            if (agentEnt.waitingForDestructionCleanUp === false) break;
        }
        // await agentBot.runStep(orm.em);
        const status = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status, AgentStatus.DESTROYING);
    });

    it("Should fail to send notification - 'faulty notifier", async () => {
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress, new FaultyNotifier());
        const spyConsole = spy.on(console, 'error');
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot.agent.vaultAddress, 2, chain);
        // check agent status
        const status1 = await getAgentStatus(agentBot);
        assert.equal(status1, AgentStatus.NORMAL);
        // change prices
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await context.assetManager.startLiquidation(agentBot.agent.vaultAddress, { from: minter.address });
        // check agent status
        const status2 = await getAgentStatus(agentBot);
        assert.equal(status2, AgentStatus.CCB);
        // run bot
        await agentBot.runStep(orm.em);
        expect(spyConsole).to.have.been.called.once;
    });

    it("Should not top up collateral - fails on owner side due to no Class1", async () => {
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const spyTopUpFailed = spy.on(agentBot.notifier, 'sendCollateralTopUpFailedAlert');
        const spyLowOwnerBalance = spy.on(agentBot.notifier, 'sendLowBalanceOnOwnersAddress');
        const spyTopUp = spy.on(agentBot.notifier, 'sendCollateralTopUpAlert');
        const minter = await createTestMinter(context, minterAddress, chain);
        // create collateral reservation, perform minting and run
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2, orm, chain);
        // change prices
        await context.assetFtso.setCurrentPrice(toBNExp(14, 6), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(14, 6), 0);
        // mock price changes and run
        await context.ftsoManager.mockFinalizePriceEpoch();
        // send notifications: top up failed and low balance on ownerAddress
        await agentBot.runStep(orm.em);
        expect(spyTopUpFailed).to.have.been.called.once;
        expect(spyLowOwnerBalance).to.have.been.called.once;
        // top up ownerAddress
        const deposit = toBNExp(5_000_000, 18).toString();
        await mintClass1ToOwner(deposit, (await agentBot.agent.getAgentInfo()).class1CollateralToken, ownerAddress);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        // send notifications: top up successful
        await agentBot.runStep(orm.em);
        expect(spyTopUp).to.have.been.called.twice;
    });

    it("Should not top up collateral - fails on owner side due to no NAT", async () => {
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const ownerBalance = toBN(await web3.eth.getBalance(ownerAddress));
        const agentB = await createTestAgentB(context, ownerAddress);
        const deposit = ownerBalance.sub(NATIVE_LOW_BALANCE);
        await agentB.buyCollateralPoolTokens(deposit);
        const spyTopUpFailed = spy.on(agentBot.notifier, 'sendCollateralTopUpFailedAlert');
        const spyLowOwnerBalance = spy.on(agentBot.notifier, 'sendLowBalanceOnOwnersAddress');
        const minter = await createTestMinter(context, minterAddress, chain);
        // create collateral reservation, perform minting and run
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2, orm, chain);
        // change prices
        await context.assetFtso.setCurrentPrice(toBNExp(14, 6), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(14, 6), 0);
        // mock price changes and run
        await context.ftsoManager.mockFinalizePriceEpoch();
        // send notifications: top up failed and low balance on ownerAddress
        await agentBot.runStep(orm.em);
        expect(spyTopUpFailed).to.have.been.called.twice;
        expect(spyLowOwnerBalance).to.have.been.called.twice;
        // redeem pool tokens
        const redeemAt = await agentB.announcePoolTokenRedemption(deposit);
        await time.increaseTo(redeemAt);
        await agentB.redeemCollateralPoolTokens(deposit);
        const ownerBalanceAfter = toBN(await web3.eth.getBalance(ownerAddress));
        expect(ownerBalanceAfter.gte(deposit)).to.be.true;
    });

    it("Should not top up collateral - fails on owner side due to no NAT", async () => {
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        // create collateral reservation, perform minting and run
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2, orm, chain);
        await context.ftsoManager.mockFinalizePriceEpoch();
        await agentBot.runStep(orm.em)
        // change prices
        await context.assetFtso.setCurrentPrice(toBNExp(10, 7), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(10, 7), 0);
        await context.ftsoManager.mockFinalizePriceEpoch();
        // create another agent and buy pool tokens
        const agent = await createTestAgentB(context, ownerAddress);
        const ownerBalance = toBN(await web3.eth.getBalance(ownerAddress));
        const forDeposit = ownerBalance.sub(ownerBalance.divn(1000000));
        await agent.buyCollateralPoolTokens(forDeposit);
        // check for top up collateral
        await agentBot.runStep(orm.em)
        // redeem pool tokens
        const redeemAt = await agent.announcePoolTokenRedemption(forDeposit);
        await time.increaseTo(redeemAt);
        await agent.redeemCollateralPoolTokens(forDeposit);
        const ownerBalanceAfter = toBN(await web3.eth.getBalance(ownerAddress));
        expect(ownerBalanceAfter.gte(forDeposit)).to.be.true;
    });

});