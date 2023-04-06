import { expectRevert, time } from "@openzeppelin/test-helpers";
import { assert } from "chai";
import { AgentBot, AgentStatus } from "../../src/actors/AgentBot";
import { ORM } from "../../src/config/orm";
import { Minter } from "../../src/mock/Minter";
import { MockChain } from "../../src/mock/MockChain";
import { Redeemer } from "../../src/mock/Redeemer";
import { CCB_LIQUIDATION_PREVENTION_FACTOR, checkedCast, NATIVE_LOW_BALANCE, QUERY_WINDOW_SECONDS, toBN, toBNExp } from "../../src/utils/helpers";
import { web3 } from "../../src/utils/web3";
import { createTestAssetContext, TestAssetBotContext } from "../test-utils/test-asset-context";
import { testChainInfo } from "../../test/test-utils/TestChainInfo";
import { AgentEntity, AgentMintingState, AgentRedemptionState } from "../../src/entities/agent";
import { createAgentBot, createAgentBotAndMakeAvailable, createMinter, createRedeemer, disableMccTraceManager } from "../test-utils/helpers";
import { FilterQuery } from "@mikro-orm/core/typings";
import { overrideAndCreateOrm } from "../../src/mikro-orm.config";
import { createTestOrmOptions } from "../../test/test-utils/test-bot-config";
import spies from "chai-spies";
import { expect, spy, use } from "chai";
use(spies);
import rewire from "rewire";
const rewiredAgentBot = rewire("../../src/actors/AgentBot");
const rewiredAgentBotClass = rewiredAgentBot.__get__("AgentBot");

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
        chain = checkedCast(context.chain, MockChain);
        settings = await context.assetManager.getSettings();
        agentBot = await createAgentBotAndMakeAvailable(context, orm, ownerAddress);
        minter = await createMinter(context, minterAddress, chain);
        chain.mine(chain.finalizationBlocks + 1);
        redeemer = await createRedeemer(context, redeemerAddress);
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
    //TODO unstick minting
    it.skip("Should perform unstick minting - minter does not pay and time expires in indexer", async () => {
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
        console.log(Number(crt.lastUnderlyingTimestamp) + queryWindow)
        console.log(Number(crt.lastUnderlyingBlock) + queryBlock)
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
    //TODO unstick minting
    it.skip("Should perform unstick minting - minter pays and time expires in indexer", async () => {
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
        const startBalanceRedeemer = await agentBot.agent.class1Token.balanceOf(redeemer.address);
        const startBalanceAgent = await agentBot.agent.class1Token.balanceOf(agentBot.agent.agentVault.address);
        const res = await redeemer.redemptionPaymentDefault(rdReq);
        const endBalanceRedeemer = await agentBot.agent.class1Token.balanceOf(redeemer.address);
        const endBalanceAgent = await agentBot.agent.class1Token.balanceOf(agentBot.agent.agentVault.address);
        assert.equal(String(endBalanceRedeemer.sub(startBalanceRedeemer)), String(res.redeemedClass1CollateralWei));
        assert.equal(String(startBalanceAgent.sub(endBalanceAgent)), String(res.redeemedClass1CollateralWei));
        // check if redemption is done
        await agentBot.runStep(orm.em);
        orm.em.clear();
        const redemptionDone = await agentBot.findRedemption(orm.em, rdReq.requestId);
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
        await agentBot.runStep(orm.em);
        orm.em.clear();
        const redemptionDone = await agentBot.findRedemption(orm.em, rdReq.requestId);
        assert.equal(redemptionDone.state, AgentRedemptionState.DONE);
    });

    it.only("Should not perform redemption - agent does not confirm, anyone can confirm time expired on underlying", async () => {
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
        const startBalance = await agentBot.agent.class1Token.balanceOf(someAddress);
        const proof = await context.attestationProvider.provePayment(redemptionPaid.txHash!, agentBot.agent.underlyingAddress, rdReq.paymentAddress);
        await context.assetManager.confirmRedemptionPayment(proof, rdReq.requestId, { from: someAddress });
        const endBalance = await agentBot.agent.class1Token.balanceOf(someAddress);
        console.log(startBalance.toString())
        console.log(endBalance.toString())
        const {0: price } = await context.ftsos[agentBot.agent.class1Collateral.tokenFtsoSymbol].getCurrentPrice();
        // function convertFromUSD5(
        //     uint256 _amountUSD5,
        //     CollateralToken.Data storage _token
        // )
        //     internal view
        //     returns (uint256)
        // {
        //     // if tokenFtsoSymbol is empty, it is assumed that the token is a USD-like stablecoin
        //     // so `_amountUSD5` is (approximately) the correct amount of tokens
        //     if (bytes(_token.tokenFtsoSymbol).length == 0) {
        //         return _amountUSD5;
        //     }
        //     (uint256 tokenPrice,, uint256 tokenFtsoDec) = readFtsoPrice(_token.tokenFtsoSymbol, false);
        //     uint256 expPlus = _token.decimals + tokenFtsoDec;
        //     // 1e10 in divisor: 5 for amount decimals, 5 for price decimals
        //     return _amountUSD5.mulDiv(tokenPrice * 10 ** expPlus, 1e10);
        // }
        assert.equal(String(endBalance.sub(startBalance)), String(settings.confirmationByOthersRewardUSD5));
    });

    it.skip("Should perform minting and change status from NORMAL to LIQUIDATION", async () => {
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
        await context.assetFtso.setCurrentPrice(toBNExp(3521, 50), 0);
        await context.assetManager.startLiquidation(agentBot.agent.vaultAddress);
        await agentBot.runStep(orm.em);
        // check agent status
        const status2 = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status2, AgentStatus.LIQUIDATION);
    });

    it.skip("Should perform minting and change status from NORMAL via LIQUIDATION to NORMAL", async () => {
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
        // start liquidation
        await context.assetManager.startLiquidation(agentBot.agent.vaultAddress);
        // check agent status
        const status2 = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status2, AgentStatus.LIQUIDATION);
        // change price back
        const { 0: assetPrice2 } = await context.assetFtso.getCurrentPrice();
        await context.assetFtso.setCurrentPrice(assetPrice2.divn(10000), 0);
        // agent ends liquidation
        await agentBot.agent.endLiquidation();
        // check agent status
        const status3 = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status3, AgentStatus.NORMAL);
    });

    it.skip("Should check collateral ratio after price changes", async () => {
        const spyTop = spy.on(agentBot, 'checkAgentForCollateralRatioAndTopUp');
        // mock price changes
        await context.ftsoManager.mockFinalizePriceEpoch();
        // check collateral ratio after price changes
        await agentBot.runStep(orm.em);
        expect(spyTop).to.have.been.called.once;
    });

    it.skip("Should check collateral ratio after price changes 2", async () => {
        const ownerAddress2 = accounts[30];
        const agentBot2 = await rewiredAgentBotClass.create(orm.em, context, ownerAddress2);
        await agentBot2.agent.depositCollateral(toBNExp(1_000_000, 18));
        await agentBot2.agent.makeAvailable(500, 25000);
        const spyTop = spy.on(agentBot2, 'checkAgentForCollateralRatioAndTopUp');
        // create collateral reservation
        await minter.reserveCollateral(agentBot2.agent.vaultAddress, 2);
        // change price
        const { 0: assetPrice } = await context.assetFtso.getCurrentPrice();
        await context.assetFtso.setCurrentPrice(assetPrice.muln(10000), 0);
        // expect cr to be less than required cr
        const crBIPSBefore = (await agentBot2.agent.getAgentInfo()).class1CollateralRatioBIPS;
        const crRequiredBIPS = toBN(settings.minCollateralRatioBIPS).muln(CCB_LIQUIDATION_PREVENTION_FACTOR);
        expect(Number(crBIPSBefore)).lt(Number(crRequiredBIPS));
        // mock price changes
        await context.ftsoManager.mockFinalizePriceEpoch();
        // remove some native from owner's address
        const requiredCrBIPS = toBN(settings.minCollateralRatioBIPS).muln(CCB_LIQUIDATION_PREVENTION_FACTOR);
        const requiredTopUp = await agentBot2.requiredTopUp(requiredCrBIPS, await agentBot2.agent.getAgentInfo(), settings);
        const owner2Balance = toBN(await web3.eth.getBalance(ownerAddress2));
        const sub = owner2Balance.sub(requiredTopUp).sub(NATIVE_LOW_BALANCE)
        const agentBot3 = await createAgentBot(context, orm, ownerAddress2);
        await agentBot3.agent.depositClass1Collateral(sub);
        // check collateral ratio after price changes
        await agentBot2.runStep(orm.em);
        // expect cr to be the same as required cr
        const crBIPSAfter = (await agentBot2.agent.getAgentInfo()).class1CollateralRatioBIPS;
        expect(Number(crBIPSAfter)).eq(Number(crRequiredBIPS));
        // change price
        const { 0: assetPrice2 } = await context.assetFtso.getCurrentPrice();
        await context.assetFtso.setCurrentPrice(assetPrice2.muln(10000), 0);
        // mock price changes
        await context.ftsoManager.mockFinalizePriceEpoch();
        await agentBot2.runStep(orm.em);
        expect(spyTop).to.have.been.called.twice;
    });

    it.skip("Should announce agent destruction, change status from NORMAL via DESTROYING, destruct agent and set active to false", async () => {
        const agentBotEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress, } as FilterQuery<AgentEntity>);
        // check agent status
        const status = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status, AgentStatus.NORMAL);
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

    it.skip("Should announce to close vault only if no tickets are open for that agent", async () => {
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
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
        // exit available
        const exitAllowedAt = await agentBot.agent.announceExitAvailable();
        await time.increaseTo(exitAllowedAt);
        await agentBot.agent.exitAvailable();
        // close vault
        agentEnt.waitingForDestructionCleanUp = true;
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(agentEnt.waitingForDestructionCleanUp).to.be.true;
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
            if (redemption.state === AgentRedemptionState.REQUESTED_PROOF) break;
        }
        await agentBot.runStep(orm.em);
        const status = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status, AgentStatus.DESTROYING);
    });

});