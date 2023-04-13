import { assert } from "chai";
import { MockChain, MockTransactionOptionsWithFee } from "../../../src/mock/MockChain";
import { checkedCast, MAX_BIPS, QUERY_WINDOW_SECONDS, toBN, toBNExp, toWei } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/create-test-asset-context";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { Agent } from "../../../src/fasset/Agent";
import { expectRevert, time } from "@openzeppelin/test-helpers";
import { convertLotsToUBA } from "../../../src/fasset/Conversions";
import { TX_BLOCKED } from "../../../src/underlying-chain/interfaces/IBlockChain";
import spies from "chai-spies";
import { expect, spy, use } from "chai";
import { createCRAndPerformMinting, createTestAgent, createTestAgentAndMakeAvailable, createTestMinter, createTestRedeemer, disableMccTraceManager, mintAndDepositClass1ToOwner } from "../../test-utils/helpers";
use(spies);

const underlyingAddress: string = "UNDERLYING_ADDRESS";
const deposit = toBNExp(1_000_000, 18);
const withdraw = toBNExp(1, 18);

describe("Agent unit tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let ownerAddress: string;
    let minterAddress: string;
    let redeemerAddress: string;
    let chain: MockChain;

    before(async () => {
        disableMccTraceManager();
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

    afterEach(function () {
        spy.restore(Agent);
    });

    it("Should create agent", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        expect(agent.ownerAddress).to.eq(ownerAddress);
        expect(agent.underlyingAddress).to.eq(underlyingAddress);
    });

    it("Should get assetManager", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        const assetManager = agent.assetManager;
        expect(assetManager.address).to.eq(context.assetManager.address);
    });

    it("Should get attestationProvider", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        const attestationProvider = agent.attestationProvider;
        expect(attestationProvider.chainId).to.eq(context.attestationProvider.chainId);
    });

    it("Should get vaultAddress", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        const vaultAddress = agent.vaultAddress;
        expect(vaultAddress).to.eq(agent.agentVault.address);
    });

    it("Should get wallet", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        const wallet = agent.wallet;
        expect(wallet).to.not.be.null;
    });

    it("Should get underlying address", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        const agentsUnderlyingAddress = agent.underlyingAddress;
        expect(agentsUnderlyingAddress).to.eq(underlyingAddress);
    });

    it("Should get asset manager settings", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        const settings = await agent.getAssetManagerSettings();
        expect(settings).to.not.be.null;
    });


    it("Should get agent collateral", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        const agentCollateral = await agent.getAgentCollateral();
        expect(agentCollateral).to.not.be.null;
        expect(agentCollateral.class1.collateral?.token).to.eq(agent.class1Token.address);
    });

    it("Should deposit collateral", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        const class1TokenContract = await mintAndDepositClass1ToOwner(context, agent.vaultAddress, deposit, ownerAddress);
        await agent.depositClass1Collateral(deposit);
        const val = await class1TokenContract.balanceOf(agent.vaultAddress);
        expect(val.toString()).to.eq(deposit.toString());
    });

    it("Should make agent available", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        await mintAndDepositClass1ToOwner(context, agent.vaultAddress, deposit, ownerAddress);
        await agent.depositClass1Collateral(deposit);
        await agent.buyCollateralPoolTokens(deposit);
        await agent.makeAvailable();
        const agentInfo = await agent.getAgentInfo();
        expect(agentInfo.publiclyAvailable).to.be.true;
    });

    it("Should deposit collateral and make available", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        await mintAndDepositClass1ToOwner(context, agent.vaultAddress, deposit, ownerAddress);
        await agent.depositCollateralsAndMakeAvailable(deposit, deposit);
        const agentCollateral = await agent.getAgentCollateral();
        expect(agentCollateral.class1.balance.eq(deposit)).to.be.true;
        expect(agentCollateral.agentPoolTokens.balance.eq(deposit)).to.be.true;
        const agentInfo = await agent.getAgentInfo();
        expect(agentInfo.publiclyAvailable).to.be.true;
    });

    it("Should announce collateral withdrawal and withdraw", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        const class1TokenContract = await mintAndDepositClass1ToOwner(context, agent.vaultAddress, deposit, ownerAddress);
        await agent.depositClass1Collateral(deposit);
        await agent.announceClass1CollateralWithdrawal(withdraw);
        const settings = await context.assetManager.getSettings();
        await time.increase(settings.withdrawalWaitMinSeconds);
        await agent.withdrawClass1Collateral(withdraw);
        const val = await class1TokenContract.balanceOf(agent.vaultAddress);
        expect(Number(val)).to.eq(Number(deposit.sub(withdraw)));
    });

    it("Should announce agent destruction and destroy it", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        // await agent.depositCollateral(deposit);
        await agent.announceDestroy();
        const settings = await context.assetManager.getSettings();
        await time.increase(settings.withdrawalWaitMinSeconds);
        const res = await agent.destroy();
        expect(res.agentVault).to.eq(agent.agentVault.address);
    });

    it("Should perform and confirm top up", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        const spyAgent = spy.on(agent.assetManager, 'confirmTopupPayment');
        const tx = await agent.performTopupPayment(1, underlyingAddress);
        chain.mine(chain.finalizationBlocks + 1);
        await agent.confirmTopupPayment(tx);
        expect(spyAgent).to.have.been.called.once;
    });

    it("Should announce, perform and confirm underlying withdrawal", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        const resAnnounce = await agent.announceUnderlyingWithdrawal();
        const tx = await agent.performUnderlyingWithdrawal(resAnnounce, 1, underlyingAddress);
        chain.mine(chain.finalizationBlocks + 1);
        const skipTime = (await context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds;
        await time.increase(skipTime);
        const resConfirm = await agent.confirmUnderlyingWithdrawal(resAnnounce, tx);
        expect(resConfirm.agentVault).to.eq(agent.vaultAddress);
    });

    it("Should announce, perform and confirm underlying withdrawal", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        const resAnnounce = await agent.announceUnderlyingWithdrawal();
        const tx = await agent.performUnderlyingWithdrawal(resAnnounce, 1, underlyingAddress);
        chain.mine(chain.finalizationBlocks + 1);
        const skipTime = (await context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds;
        await time.increase(skipTime);
        const resConfirm = await agent.confirmUnderlyingWithdrawal(resAnnounce, tx);
        expect(resConfirm.agentVault).to.eq(agent.vaultAddress);
    });

    it("Should announce and cancel underlying withdrawal", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        await agent.announceUnderlyingWithdrawal();
        const skipTime = (await context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds;
        await time.increase(skipTime);
        const resConfirm = await agent.cancelUnderlyingWithdrawal();
        expect(resConfirm.agentVault).to.eq(agent.vaultAddress);
    });

    it("Should self close", async () => {
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress, underlyingAddress);
        // execute minting
        const minter = await createTestMinter(context, minterAddress, chain);
        const crt = await minter.reserveCollateral(agent.vaultAddress, 2);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(ownerAddress, fBalance, { from: minter.address });
        await agent.selfClose(fBalance.divn(2));
        const fBalanceAfter = await context.fAsset.balanceOf(ownerAddress);
        expect(fBalanceAfter.toString()).to.eq(fBalance.divn(2).toString());
    });

    it("Should not buy back agent collateral", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        await expectRevert(agent.buybackAgentCollateral(), "f-asset not terminated");
    });

    it("Should exit available", async () => {
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress, underlyingAddress);
        const exitAllowedAt = await agent.announceExitAvailable();
        await time.increaseTo(exitAllowedAt);
        const res = await agent.exitAvailable();
        expect(res.agentVault).to.eq(agent.agentVault.address);
    });

    it("Should execute minting", async () => {
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress, underlyingAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        const lots = 3;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        const minted = await agent.executeMinting(crt, txHash);
        chain.mine(chain.finalizationBlocks + 1);
        expect(minted.mintedAmountUBA.toString()).to.eq(convertLotsToUBA(await context.assetManager.getSettings(), lots).toString());
    });

    it("Should unstick minting", async () => {
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress, underlyingAddress);
        const spyAgent = spy.on(agent.assetManager, 'unstickMinting');
        const minter = await createTestMinter(context, minterAddress, chain);
        const lots = 2;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const queryWindow = QUERY_WINDOW_SECONDS * 2;
        const queryBlock = Math.round(queryWindow / chain.secondsPerBlock);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp) + queryWindow);
        chain.mine(Number(crt.lastUnderlyingBlock) + queryBlock);
        const settings = await context.assetManager.getSettings();
        const agentCollateral = await agent.getAgentCollateral();
        const burnNats = agentCollateral.pool.convertUBAToTokenWei(crt.valueUBA).mul(toBN(settings.class1BuyForFlareFactorBIPS)).divn(MAX_BIPS);
        await agent.unstickMinting(crt, burnNats);
        expect(spyAgent).to.have.been.called.once;
    });

    it("Should execute mintingPaymentDefault", async () => {
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress, underlyingAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        const lots = 2;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp));
        chain.mine(Number(crt.lastUnderlyingBlock));
        const res = await agent.mintingPaymentDefault(crt);
        expect(res.agentVault).to.eq(agent.agentVault.address);
    });

    it("Should mint, redeem and confirm active redemption payment", async () => {
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress, underlyingAddress);
        const spyAgent = spy.on(agent.assetManager, 'confirmRedemptionPayment');
        const minter = await createTestMinter(context, minterAddress, chain);
        const lots = 1;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        chain.mine(chain.finalizationBlocks + 1);
        const redeemer = await createTestRedeemer(context, redeemerAddress);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        const [rdReqs] = await redeemer.requestRedemption(lots);
        const tx1Hash = await agent.performRedemptionPayment(rdReqs[0]);
        await agent.confirmActiveRedemptionPayment(rdReqs[0], tx1Hash);
        expect(spyAgent).to.have.been.called.once;
    });

    it("Should not perform redemption - agent does not pay, time expires on underlying", async () => {
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress, underlyingAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        const lots = 1;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        chain.mine(chain.finalizationBlocks + 1);
        const redeemer = await createTestRedeemer(context, redeemerAddress);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        const [rdReqs] = await redeemer.requestRedemption(lots);
        const rdReq = rdReqs[0];
        // skip time so the payment will expire on underlying chain
        chain.skipTimeTo(Number(rdReq.lastUnderlyingTimestamp));
        chain.mine(Number(rdReq.lastUnderlyingBlock));
        // agent triggers payment default and gets paid in collateral with extra
        const startBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
        const startBalanceAgent = await context.wNat.balanceOf(agent.collateralPool.address);
        const res = await agent.redemptionPaymentDefault(rdReq);
        const endBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
        const endBalanceAgent = await context.wNat.balanceOf(agent.collateralPool.address);
        assert.equal(String(endBalanceRedeemer.sub(startBalanceRedeemer)), String(res.redeemedPoolCollateralWei));
        assert.equal(String(startBalanceAgent.sub(endBalanceAgent)), String(res.redeemedPoolCollateralWei));
        const resp = await agent.finishRedemptionWithoutPayment(rdReq);
        assert.equal(String(resp[0]?.requestId), String(rdReq.requestId));
    });

    it("Should not perform redemption - agent does not pay, time expires on underlying 2", async () => {
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress, underlyingAddress);
        const spyAgent = spy.on(agent.assetManager, 'confirmRedemptionPayment');
        const minter = await createTestMinter(context, minterAddress, chain);
        const lots = 1;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const tx1Hash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await agent.executeMinting(crt, tx1Hash, minter.underlyingAddress);
        chain.mine(chain.finalizationBlocks + 1);
        const redeemer = await createTestRedeemer(context, redeemerAddress);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        const [rdReqs] = await redeemer.requestRedemption(lots);
        const rdReq = rdReqs[0];
        // skip time so the payment will expire on underlying chain
        chain.skipTimeTo(Number(rdReq.lastUnderlyingTimestamp));
        chain.mine(Number(rdReq.lastUnderlyingBlock));
        // agent triggers payment default and gets paid in collateral with extra
        const startBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
        const startBalanceAgent = await context.wNat.balanceOf(agent.collateralPool.address);
        const res = await agent.redemptionPaymentDefault(rdReq);
        const endBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
        const endBalanceAgent = await context.wNat.balanceOf(agent.collateralPool.address);
        assert.equal(String(endBalanceRedeemer.sub(startBalanceRedeemer)), String(res.redeemedPoolCollateralWei));
        assert.equal(String(startBalanceAgent.sub(endBalanceAgent)), String(res.redeemedPoolCollateralWei));
        const tx2Hash = await agent.performRedemptionPayment(rdReq);
        await agent.confirmDefaultedRedemptionPayment(rdReq, tx2Hash);
        expect(spyAgent).to.have.been.called.once;
    });

    it("Should not perform redemption - failed underlying payment (not redeemer's address)", async () => {
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress, underlyingAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        const lots = 1;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const tx1Hash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, tx1Hash);
        chain.mine(chain.finalizationBlocks + 1);
        const redeemer = await createTestRedeemer(context, redeemerAddress);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        const [rdReqs] = await redeemer.requestRedemption(lots);
        const rdReq = rdReqs[0];
        // pay for redemption - wrong underlying address
        rdReq.paymentAddress = minter.underlyingAddress;
        const tx2Hash = await agent.performRedemptionPayment(rdReq);
        const startBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
        const startBalanceAgent = await context.wNat.balanceOf(agent.collateralPool.address);
        const res = await agent.confirmFailedRedemptionPayment(rdReq, tx2Hash);
        // check end balance
        const endBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
        const endBalanceAgent = await context.wNat.balanceOf(agent.collateralPool.address);
        // asserts
        assert(res[0].failureReason, "not redeemer's address");
        assert(endBalanceRedeemer.sub(startBalanceRedeemer), String(res[1].redeemedPoolCollateralWei));
        assert(startBalanceAgent.sub(endBalanceAgent), String(res[1].redeemedPoolCollateralWei));
    });

    it("Should not perform redemption - failed underlying payment (blocked)", async () => {
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress, underlyingAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        const lots = 1;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const tx1Hash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, tx1Hash);
        chain.mine(chain.finalizationBlocks + 1);
        const redeemer = await createTestRedeemer(context, redeemerAddress);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        const [rdReqs] = await redeemer.requestRedemption(lots);
        const rdReq = rdReqs[0];
        // pay for redemption - payment blocked
        const paymentAmount = rdReq.valueUBA.sub(rdReq.feeUBA);
        const txHash = await context.wallet.addTransaction(agent.underlyingAddress, rdReq.paymentAddress, paymentAmount, rdReq.paymentReference, { status: TX_BLOCKED } as MockTransactionOptionsWithFee);
        chain.mine(chain.finalizationBlocks + 1);
        const res = await agent.confirmBlockedRedemptionPayment(rdReq, txHash);
        expect(res.agentVault).to.eq(agent.vaultAddress);
        expect(res.redeemer).to.eq(redeemer.address);
    });

    it("Should self mint", async () => {
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress, underlyingAddress);
        const lots = 3;
        const amountUBA = convertLotsToUBA(await context.assetManager.getSettings(), lots);
        const poolFee = amountUBA.mul(toBN(agent.agentSettings.feeBIPS)).mul(toBN(agent.agentSettings.poolFeeShareBIPS))
        const randomUnderlyingAddress = "RANDOM_UNDERLYING";
        const allAmountUBA = amountUBA.add(poolFee);
        context.chain.mint(randomUnderlyingAddress, allAmountUBA);
        const mintAmount = amountUBA.add(poolFee);
        context.chain.mint(randomUnderlyingAddress, mintAmount);
        const selfMint = await agent.selfMint(randomUnderlyingAddress, allAmountUBA, lots);
        assert(selfMint.mintedAmountUBA.toString(), amountUBA.toString());
    });

    it("Should withdraw pool fees", async () => {
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress, underlyingAddress);
        const fPoolBalanceBefore = await agent.poolFeeBalance();
        expect(fPoolBalanceBefore.eqn(0)).to.be.true;
        const minter = await createTestMinter(context, minterAddress, chain);
        await createCRAndPerformMinting(minter, agent.vaultAddress, 2, chain);
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(agent.collateralPool.address, fBalance, { from: minter.address });
        // withdraw pool fees
        const fPoolBalanceBeforeWithdraw = await agent.poolFeeBalance();
        await agent.withdrawPoolFees(fBalance);
        const fPoolBalanceAfterWithdraw = await agent.poolFeeBalance();
        const ownerFassets = await context.fAsset.balanceOf(agent.ownerAddress);
        expect(ownerFassets.eq(fBalance)).to.be.true;
        expect(fPoolBalanceAfterWithdraw.toString()).to.eq(fPoolBalanceBeforeWithdraw.sub(fBalance).toString());
    });

});
