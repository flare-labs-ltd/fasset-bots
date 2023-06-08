import { MockChain } from "../../../src/mock/MockChain";
import { checkedCast, toBNExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/create-test-asset-context";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { Agent } from "../../../src/fasset/Agent";
import { time } from "@openzeppelin/test-helpers";
import spies from "chai-spies";
import { expect, spy, use } from "chai";
import { createCRAndPerformMinting, createTestAgent, createTestAgentAndMakeAvailable, createTestMinter, disableMccTraceManager, mintAndDepositClass1ToOwner } from "../../test-utils/helpers";
use(spies);

const underlyingAddress: string = "UNDERLYING_ADDRESS";
const deposit = toBNExp(1_000_000, 18);
const withdraw = toBNExp(1, 18);

describe("Agent unit tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let ownerAddress: string;
    let minterAddress: string;
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

    it("Should deposit collateral", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        const class1TokenContract = await mintAndDepositClass1ToOwner(context, agent, deposit, ownerAddress);
        await agent.depositClass1Collateral(deposit);
        const val = await class1TokenContract.balanceOf(agent.vaultAddress);
        expect(val.toString()).to.eq(deposit.toString());
    });

    it("Should make agent available", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        await mintAndDepositClass1ToOwner(context, agent, deposit, ownerAddress);
        await agent.depositClass1Collateral(deposit);
        await agent.buyCollateralPoolTokens(deposit);
        await agent.makeAvailable();
        const agentInfo = await agent.getAgentInfo();
        expect(agentInfo.publiclyAvailable).to.be.true;
    });

    it("Should announce collateral withdrawal and withdraw", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        const class1TokenContract = await mintAndDepositClass1ToOwner(context, agent, deposit, ownerAddress);
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
        const tx = await agent.performUnderlyingWithdrawal(resAnnounce.paymentReference, 1, underlyingAddress);
        chain.mine(chain.finalizationBlocks + 1);
        const skipTime = (await context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds;
        await time.increase(skipTime);
        const resConfirm = await agent.confirmUnderlyingWithdrawal(tx);
        expect(resConfirm.agentVault).to.eq(agent.vaultAddress);
    });

    it("Should announce, perform and confirm underlying withdrawal", async () => {
        const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
        const resAnnounce = await agent.announceUnderlyingWithdrawal();
        const tx = await agent.performUnderlyingWithdrawal(resAnnounce.paymentReference, 1, underlyingAddress);
        chain.mine(chain.finalizationBlocks + 1);
        const skipTime = (await context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds;
        await time.increase(skipTime);
        const resConfirm = await agent.confirmUnderlyingWithdrawal(tx);
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

    it("Should exit available", async () => {
        const agent = await createTestAgentAndMakeAvailable(context, ownerAddress, underlyingAddress);
        const exitAllowedAt = await agent.announceExitAvailable();
        await time.increaseTo(exitAllowedAt);
        const res = await agent.exitAvailable();
        expect(res.agentVault).to.eq(agent.agentVault.address);
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
        const fPoolBalance = await agent.poolFeeBalance();
        await agent.withdrawPoolFees(fPoolBalance);
        const fPoolBalanceAfterWithdraw = await agent.poolFeeBalance();
        const ownerFassets = await context.fAsset.balanceOf(agent.ownerAddress);
        expect(ownerFassets.eq(fPoolBalance)).to.be.true;
        expect(fPoolBalanceAfterWithdraw.eqn(0)).to.be.true;
    });

});
