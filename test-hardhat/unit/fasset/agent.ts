import { assert } from "chai";
import { MockChain } from "../../../src/mock/MockChain";
import { checkedCast, QUERY_WINDOW_SECONDS, toBNExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestAssetContext } from "../../utils/test-asset-context";
import { testChainInfo } from "../../../test/utils/TestChainInfo";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { Agent } from "../../../src/fasset/Agent";
import { expectRevert, time } from "@openzeppelin/test-helpers";
import { SourceId } from "../../../src/verification/sources/sources";
import { Minter } from "../../../src/mock/Minter";
import { convertLotsToUBA } from "../../../src/fasset/Conversions";
import { Redeemer } from "../../../src/mock/Redeemer";
const chai = require('chai');
const spies = require('chai-spies');
chai.use(spies);
const expect = chai.expect;

const minterUnderlying: string = "MINTER_ADDRESS";
const underlyingAddress: string = "UNDERLYING_ADDRESS";
const redeemerUnderlying: string = "REDEEMER_ADDRESS";
const deposit = toBNExp(1_000_000, 18);
const withdraw = toBNExp(1, 18);

describe("Agent unit tests", async () => {
    let accounts: string[];
    let context: IAssetBotContext;
    let ownerAddress: string;
    let minterAddress: string;
    let redeemerAddress: string;
    let chain: MockChain;

    before(async () => {
        accounts = await web3.eth.getAccounts();
    });

    beforeEach(async () => {
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.chain, MockChain);
        ownerAddress = accounts[3];
        minterAddress = accounts[4];
        redeemerAddress = accounts[5];
        // chain tunning
        chain.finalizationBlocks = 0;
        chain.secondsPerBlock = 1;
    });

    it("Should create agent", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        expect(agent.ownerAddress).to.eq(ownerAddress);
        expect(agent.underlyingAddress).to.eq(underlyingAddress);
    });

    it("Should get assetManager", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        const assetManager = agent.assetManager;
        expect(assetManager.address).to.eq(context.assetManager.address);
    });

    it("Should get attestationProvider", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        const attestationProvider = agent.attestationProvider;
        expect(attestationProvider.chainId).to.eq(context.attestationProvider.chainId);
    });

    it("Should get vaultAddress", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        const vaultAddress = agent.vaultAddress;
        expect(vaultAddress).to.eq(agent.agentVault.address);
    });

    it("Should get wallet", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        const wallet = agent.wallet;
        expect(wallet.chain.finalizationBlocks).to.eq(context.wallet.chain.finalizationBlocks);
    });

    it("Should deposit collateral", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        await agent.depositCollateral(deposit);
        const val = await context.wnat.balanceOf(agent.vaultAddress);
        expect(Number(val)).to.eq(Number(deposit));
    });

    it("Should make agent available", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        await agent.depositCollateral(deposit);
        const res = await agent.makeAvailable(500, 25000);
        expect(res.agentVault).to.eq(agent.vaultAddress);
    });

    it("Should announce collateral withdrawal and withdraw", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        await agent.depositCollateral(deposit);
        await agent.announceCollateralWithdrawal(withdraw);
        await time.increase(300);
        await agent.withdrawCollateral(withdraw);
        const val = await context.wnat.balanceOf(agent.vaultAddress);
        expect(Number(val)).to.eq(Number(deposit.sub(withdraw)));
    });

    it("Should announce agent destroyal and destroy", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        await agent.depositCollateral(deposit);
        await agent.announceDestroy();
        await time.increase(300);
        const res = await agent.destroy();
        expect(res.agentVault).to.eq(agent.agentVault.address);
    });

    it("Should perform and confirm topup", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        const spy = chai.spy.on(agent, 'confirmTopupPayment');
        const tx = await agent.performTopupPayment(1, underlyingAddress);
        chain.mine(chain.finalizationBlocks + 1);
        await agent.confirmTopupPayment(tx);
        expect(spy).to.have.been.called.once;
    });

    it("Should announce, perform and confirm underlying withdrawal", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        const resAnnounce = await agent.announceUnderlyingWithdrawal();
        const tx = await agent.performUnderlyingWithdrawal(resAnnounce, 1, underlyingAddress);
        chain.mine(chain.finalizationBlocks + 1);
        const skipTime = (await context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds
        await time.increase(skipTime);
        const resConfirm = await agent.confirmUnderlyingWithdrawal(resAnnounce, tx);
        expect(resConfirm.agentVault).to.eq(agent.vaultAddress);
    });

    it("Should announce, perform and confirm underlying withdrawal", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        const resAnnounce = await agent.announceUnderlyingWithdrawal();
        const tx = await agent.performUnderlyingWithdrawal(resAnnounce, 1, underlyingAddress);
        chain.mine(chain.finalizationBlocks + 1);
        const skipTime = (await context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds
        await time.increase(skipTime);
        const resConfirm = await agent.confirmUnderlyingWithdrawal(resAnnounce, tx);
        expect(resConfirm.agentVault).to.eq(agent.vaultAddress);
    });

    it("Should announce and cancel underlying withdrawal", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        const resAnnounce = await agent.announceUnderlyingWithdrawal();
        const skipTime = (await context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds
        await time.increase(skipTime);
        const resConfirm = await agent.cancelUnderlyingWithdrawal(resAnnounce);
        expect(resConfirm.agentVault).to.eq(agent.vaultAddress);
    });

    it("Should self close", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        const res = await agent.selfClose(1);
        expect(res.agentVault).to.eq(agent.vaultAddress);
    });

    it("Should not buy back agent collateral", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        await expectRevert(agent.buybackAgentCollateral(), "f-asset not terminated");
    });

    it("Should prove EOA address", async () => {
        const spy = chai.spy.on(Agent, 'proveAddressEOA');
        const testChain = {
            chainId: SourceId.XRP,
            name: "Ripple",
            symbol: "XRP",
            decimals: 6,
            amgDecimals: 0,
            blockTime: 10,
            finalizationBlocks: 0,
            requireEOAProof: true
        }
        const contextEOA = await createTestAssetContext(accounts[0], testChain);
        await Agent.proveAddressEOA(contextEOA, ownerAddress, underlyingAddress);
        expect(spy).to.have.been.called.once;
    });

    it("Should not prove EOA address", async () => {
        const spy = chai.spy.on(Agent, 'proveAddressEOA');
        await Agent.proveAddressEOA(context, ownerAddress, underlyingAddress);
        expect(spy).to.have.been.called.once;
    });

    it("Should exit available", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        await agent.depositCollateral(deposit);
        await agent.makeAvailable(500, 25000);
        const res = await agent.exitAvailable();
        expect(res.agentVault).to.eq(agent.agentVault.address);
    });

    it("Should execute minting", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        const minter = await Minter.createTest(context, minterAddress, minterUnderlying, toBNExp(10_000, 6)); // lot is 1000 XRP
        await agent.depositCollateral(deposit);
        await agent.makeAvailable(500, 25000);
        const lots = 3;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        const minted = await agent.executeMinting(crt, txHash);
        chain.mine(chain.finalizationBlocks + 1);
        expect(minted.mintedAmountUBA.toString()).to.eq(convertLotsToUBA(await context.assetManager.getSettings(), lots).toString());
    });

    it("Should unstick minting", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        const spy = chai.spy.on(agent, 'unstickMinting');
        await agent.depositCollateral(deposit);
        await agent.makeAvailable(500, 25000);
        const minter = await Minter.createTest(context, minterAddress, minterUnderlying, toBNExp(10_000, 6)); // lot is 1000 XRP
        const lots = 2;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const queryWindow = QUERY_WINDOW_SECONDS * 2;
        const queryBlock = Math.round(queryWindow / chain.secondsPerBlock);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp) + queryWindow);
        chain.mine(Number(crt.lastUnderlyingBlock) + queryBlock);
        await agent.unstickMinting(crt);
        expect(spy).to.have.been.called.once;
    });

    it("Should execute mintingPaymentDefault", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        await agent.depositCollateral(deposit);
        await agent.makeAvailable(500, 25000);
        const minter = await Minter.createTest(context, minterAddress, minterUnderlying, toBNExp(10_000, 6)); // lot is 1000 XRP
        const lots = 2;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp))
        chain.mine(Number(crt.lastUnderlyingBlock))
        const res = await agent.mintingPaymentDefault(crt);
        expect(res.agentVault).to.eq(agent.agentVault.address);
    });

    it("Should mint, redeem and confirm active redemption payment", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        const spy = chai.spy.on(agent, 'confirmActiveRedemptionPayment');
        const minter = await Minter.createTest(context, minterAddress, minterUnderlying, toBNExp(10_000, 6)); // lot is 1000 XRP
        await agent.depositCollateral(deposit);
        await agent.makeAvailable(500, 25000);
        const lots = 1;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        chain.mine(chain.finalizationBlocks + 1);
        const redeemer = await Redeemer.create(context, redeemerAddress, redeemerUnderlying);
        // transfer fassets
        const fbalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fbalance, { from: minter.address });
        const [rdreqs] = await redeemer.requestRedemption(lots);
        const tx1Hash = await agent.performRedemptionPayment(rdreqs[0]);
        await agent.confirmActiveRedemptionPayment(rdreqs[0], tx1Hash);
        expect(spy).to.have.been.called.once;
    });

    it("Should not perform redemption - agent does not pay, time expires on underlying", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        const minter = await Minter.createTest(context, minterAddress, minterUnderlying, toBNExp(10_000, 6)); // lot is 1000 XRP
        await agent.depositCollateral(deposit);
        await agent.makeAvailable(500, 25000);
        const lots = 1;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        chain.mine(chain.finalizationBlocks + 1);
        const redeemer = await Redeemer.create(context, redeemerAddress, redeemerUnderlying);
        // transfer fassets
        const fbalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fbalance, { from: minter.address });
        const [rdreqs] = await redeemer.requestRedemption(lots);
        const rdreq = rdreqs[0];
        // skip time so the payment will expire on underlying chain
        chain.skipTimeTo(Number(rdreq.lastUnderlyingTimestamp))
        chain.mine(Number(rdreq.lastUnderlyingBlock))
        // agent triggers payment default and gets paid in collateral with extra
        const startBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
        const startBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
        const res = await agent.redemptionPaymentDefault(rdreq);
        const endBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
        const endBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
        assert.equal(String(endBalanceRedeemer.sub(startBalanceRedeemer)), String(res.redeemedCollateralWei));
        assert.equal(String(startBalanceAgent.sub(endBalanceAgent)), String(res.redeemedCollateralWei));
        const resp = await agent.finishRedemptionWithoutPayment(rdreq);
        assert.equal(String(resp[0]?.requestId), String(rdreq.requestId));
    });

    it("Should not perform redemption - agent does not pay, time expires on underlying", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        const spy = chai.spy.on(agent, 'confirmDefaultedRedemptionPayment');
        const minter = await Minter.createTest(context, minterAddress, minterUnderlying, toBNExp(10_000, 6)); // lot is 1000 XRP
        await agent.depositCollateral(deposit);
        await agent.makeAvailable(500, 25000);
        const lots = 1;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const tx1Hash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await agent.executeMinting(crt, tx1Hash, minter.underlyingAddress);
        chain.mine(chain.finalizationBlocks + 1);
        const redeemer = await Redeemer.create(context, redeemerAddress, redeemerUnderlying);
        // transfer fassets
        const fbalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fbalance, { from: minter.address });
        const [rdreqs] = await redeemer.requestRedemption(lots);
        const rdreq = rdreqs[0];
        // skip time so the payment will expire on underlying chain
        chain.skipTimeTo(Number(rdreq.lastUnderlyingTimestamp))
        chain.mine(Number(rdreq.lastUnderlyingBlock))
        // agent triggers payment default and gets paid in collateral with extra
        const startBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
        const startBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
        const res = await agent.redemptionPaymentDefault(rdreq);
        const endBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
        const endBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
        assert.equal(String(endBalanceRedeemer.sub(startBalanceRedeemer)), String(res.redeemedCollateralWei));
        assert.equal(String(startBalanceAgent.sub(endBalanceAgent)), String(res.redeemedCollateralWei));
        const tx2Hash = await agent.performRedemptionPayment(rdreq);
        await agent.confirmDefaultedRedemptionPayment(rdreq, tx2Hash);
        expect(spy).to.have.been.called.once;
    });

    it("Should not perform redemption - failed underlying payment (not redeemer's address)", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        const minter = await Minter.createTest(context, minterAddress, minterUnderlying, toBNExp(10_000, 6)); // lot is 1000 XRP
        await agent.depositCollateral(deposit);
        await agent.makeAvailable(500, 25000);
        const lots = 1;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const tx1Hash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, tx1Hash);
        chain.mine(chain.finalizationBlocks + 1);
        const redeemer = await Redeemer.create(context, redeemerAddress, redeemerUnderlying);
        // transfer fassets
        const fbalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fbalance, { from: minter.address });
        const [rdreqs] = await redeemer.requestRedemption(lots);
        const rdreq = rdreqs[0];
        // pay for redemption - wrong underlying address
        rdreq.paymentAddress = minter.underlyingAddress;
        const tx2Hash = await agent.performRedemptionPayment(rdreq);
        const startBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
        const startBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
        const res = await agent.confirmFailedRedemptionPayment(rdreq, tx2Hash);
        // check end balance
        const endBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
        const endBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
        // asserts
        assert(res[0].failureReason, "not redeemer's address");
        assert(endBalanceRedeemer.sub(startBalanceRedeemer), String(res[1].redeemedCollateralWei));
        assert(startBalanceAgent.sub(endBalanceAgent), String(res[1].redeemedCollateralWei));
    });

});
