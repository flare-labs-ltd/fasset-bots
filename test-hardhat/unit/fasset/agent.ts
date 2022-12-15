import { expect } from "chai";
import { MockChain } from "../../../src/mock/MockChain";
import { checkedCast, toBNExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestAssetContext } from "../../utils/test-asset-context";
import { testChainInfo } from "../../../test/utils/TestChainInfo";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { Agent } from "../../../src/fasset/Agent";
import { expectRevert, time } from "@openzeppelin/test-helpers";
import { SourceId } from "../../../src/verification/sources/sources";

const underlyingAddress: string = "UNDERLYING_ADDRESS";
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
        const tx = await agent.performTopupPayment(1, underlyingAddress);
        chain.mine(chain.finalizationBlocks + 1);
        await agent.confirmTopupPayment(tx);
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

    it("Should noy buyback agent collateral", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        await expectRevert(agent.buybackAgentCollateral(), "f-asset not terminated");
    });

    it("Should prove EOA address", async () => {
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
    });

    it("Should exit available", async () => {
        const agent = await Agent.create(context, ownerAddress, underlyingAddress);
        await agent.depositCollateral(deposit);
        await agent.makeAvailable(500, 25000);
        const res = await agent.exitAvailable();
        expect(res.agentVault).to.eq(agent.agentVault.address);
    });

});
