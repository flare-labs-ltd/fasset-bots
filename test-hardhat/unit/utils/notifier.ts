import { Notifier } from "../../../src/utils/Notifier";
import spies from "chai-spies";
import chaiAsPromised from "chai-as-promised";
import { expect, spy, use } from "chai";
use(chaiAsPromised);
use(spies);

const title = "TITLE";
const message = "MESSAGE";
describe("Notifier tests", async () => {
    let notifier: Notifier;

    beforeEach(() => {
        notifier = new Notifier();
    });

    afterEach(function () {
        spy.restore(notifier);
    });

    it("Should send custom message", async () => {
        const spySend = spy.on(notifier, "send");
        notifier.send(title, message);
        expect(spySend).to.have.been.called.with.exactly(title, message);
    });

    it("Should send custom message 2", async () => {
        const spySend = spy.on(notifier, "send");
        const title = "TITLE";
        notifier.send(title);
        expect(spySend).to.have.been.called.with.exactly(title);
    });

    it("Should send CCB alert", async () => {
        const spySend = spy.on(notifier, "sendCCBAlert");
        notifier.sendCCBAlert("agentVault", "0");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send liquidation started alert", async () => {
        const spySend = spy.on(notifier, "sendLiquidationStartAlert");
        notifier.sendLiquidationStartAlert("agentVault", "0");
        expect(spySend).to.have.been.called.once;
    });


    it("Should send full liquidation alert", async () => {
        const spySend = spy.on(notifier, "sendFullLiquidationAlert");
        notifier.sendFullLiquidationAlert("agentVault", "pay1", "pay2");
        notifier.sendFullLiquidationAlert("agentVault", "pay1");
        notifier.sendFullLiquidationAlert("agentVault");
        expect(spySend).to.have.been.called.exactly(3);
    });

    it("Should send liquidation was performed alert", async () => {
        const spySend = spy.on(notifier, "sendLiquidationWasPerformed");
        notifier.sendLiquidationWasPerformed("agentVault", "1000");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send minting corner case alert", async () => {
        const spySend = spy.on(notifier, "sendMintingCornerCase");
        notifier.sendMintingCornerCase("agentVault", true, false);
        notifier.sendMintingCornerCase("agentVault", false, true);
        notifier.sendMintingCornerCase("agentVault", false, false);
        expect(spySend).to.have.been.called.exactly(3);
    });

    it("Should send redemption corner case alert", async () => {
        const spySend = spy.on(notifier, "sendRedemptionCornerCase");
        notifier.sendRedemptionCornerCase("id", "agentVault");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send redemption failed or blocked alert", async () => {
        const spySend = spy.on(notifier, "sendRedemptionFailedOrBlocked");
        notifier.sendRedemptionFailedOrBlocked("reqId", "txHash", "redeemer", "agentVault", "reason");
        notifier.sendRedemptionFailedOrBlocked("reqId", "txHash", "redeemer", "agentVault");
        expect(spySend).to.have.been.called.twice;
    });

    it("Should send redemption defaulted alert", async () => {
        const spySend = spy.on(notifier, "sendRedemptionWasPerformed");
        notifier.sendRedemptionWasPerformed("reqId", "redeemer",  "agentVault");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send redemption was performed", async () => {
        const spySend = spy.on(notifier, "sendRedemptionDefaulted");
        notifier.sendRedemptionDefaulted("reqId", "redeemer",  "agentVault");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send top up collateral alert", async () => {
        const spySend = spy.on(notifier, "sendCollateralTopUpAlert");
        notifier.sendCollateralTopUpAlert("agentVault", "1");
        notifier.sendCollateralTopUpAlert("agentVault", "1", true);
        expect(spySend).to.have.been.called.twice;
    });

    it("Should send top up collateral failed alert", async () => {
        const spySend = spy.on(notifier, "sendCollateralTopUpFailedAlert");
        notifier.sendCollateralTopUpFailedAlert("agentVault", "1");
        notifier.sendCollateralTopUpFailedAlert("agentVault", "1", true);
        expect(spySend).to.have.been.called.twice;
    });

    it("Should send low underlying balance failed alert", async () => {
        const spySend = spy.on(notifier, "sendLowUnderlyingAgentBalanceFailed");
        notifier.sendLowUnderlyingAgentBalanceFailed("agentVault", "1");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send low underlying agent balance alert", async () => {
        const spySend = spy.on(notifier, "sendLowUnderlyingAgentBalance");
        notifier.sendLowUnderlyingAgentBalance("agentVault", "1");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send low balance on owner's underlying address alert", async () => {
        const spySend = spy.on(notifier, "sendLowBalanceOnUnderlyingOwnersAddress");
        notifier.sendLowBalanceOnUnderlyingOwnersAddress("underlying", "1");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send low balance on owner's address alert", async () => {
        const spySend = spy.on(notifier, "sendLowBalanceOnOwnersAddress");
        notifier.sendLowBalanceOnOwnersAddress("ownerAddress", "1", "NAT");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send no proof obtained  alert", async () => {
        const spySend = spy.on(notifier, "sendNoProofObtained");
        notifier.sendNoProofObtained("agentVault", "reqId", 1,  "data", true);
        notifier.sendNoProofObtained("agentVault", "reqId", 1, "data");
        expect(spySend).to.have.been.called.twice;
    });

    it("Should send agent destroyed  alert", async () => {
        const spySend = spy.on(notifier, "sendAgentDestroyed");
        notifier.sendAgentDestroyed("agentVault");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent created  alert", async () => {
        const spySend = spy.on(notifier, "sendAgentCreated");
        notifier.sendAgentCreated("agentVault");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent withdrew  class1 collateral", async () => {
        const spySend = spy.on(notifier, "sendWithdrawClass1");
        notifier.sendWithdrawClass1("agentVault", "100");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent updated  agent setting", async () => {
        const spySend = spy.on(notifier, "sendAgentSettingsUpdate");
        notifier.sendAgentSettingsUpdate("agentVault", "settingName");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent exited  available", async () => {
        const spySend = spy.on(notifier, "sendAgentExitedAvailable");
        notifier.sendAgentExitedAvailable("agentVault");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent announced destruction", async () => {
        const spySend = spy.on(notifier, "sendAgentAnnounceDestroy");
        notifier.sendAgentAnnounceDestroy("agentVault");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent confirmed underlying withdrawal announcement", async () => {
        const spySend = spy.on(notifier, "sendConfirmWithdrawUnderlying");
        notifier.sendConfirmWithdrawUnderlying("agentVault");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent canceled underlying withdrawal announcement", async () => {
        const spySend = spy.on(notifier, "sendCancelWithdrawUnderlying");
        notifier.sendCancelWithdrawUnderlying("agentVault");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent redeemed pool tokens", async () => {
        const spySend = spy.on(notifier, "sendCollateralPoolTokensRedemption");
        notifier.sendCollateralPoolTokensRedemption("agentVault");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent bought pool tokens", async () => {
        const spySend = spy.on(notifier, "sendBuyCollateralPoolTokens");
        notifier.sendBuyCollateralPoolTokens("agentVault", "amount");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send class1 was deposited to agent", async () => {
        const spySend = spy.on(notifier, "sendClass1Deposit");
        notifier.sendClass1Deposit("agentVault", "amount");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send pool fees were withdrawn", async () => {
        const spySend = spy.on(notifier, "sendWithdrawPoolFees");
        notifier.sendWithdrawPoolFees("agentVault", "amount");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send pool fees balance", async () => {
        const spySend = spy.on(notifier, "sendBalancePoolFees");
        notifier.sendBalancePoolFees("agentVault", "amount");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent self closed", async () => {
        const spySend = spy.on(notifier, "sendSelfClose");
        notifier.sendSelfClose("agentVault");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send already active withdrawal", async () => {
        const spySend = spy.on(notifier, "sendActiveWithdrawal");
        notifier.sendActiveWithdrawal("agentVault");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send already no active withdrawal", async () => {
        const spySend = spy.on(notifier, "sendNoActiveWithdrawal");
        notifier.sendNoActiveWithdrawal("agentVault");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send underlying withdrawal was announced", async () => {
        const spySend = spy.on(notifier, "sendAnnounceUnderlyingWithdrawal");
        notifier.sendAnnounceUnderlyingWithdrawal("agentVault", "paymentReference");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send underlying withdrawal was performed", async () => {
        const spySend = spy.on(notifier, "sendUnderlyingWithdrawalPerformed");
        notifier.sendUnderlyingWithdrawalPerformed("agentVault", "txHash");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send minting was executed", async () => {
        const spySend = spy.on(notifier, "sendMintingExecuted");
        notifier.sendMintingExecuted("agentVault", "requestId");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send minting was deleted", async () => {
        const spySend = spy.on(notifier, "sendMintingDeleted");
        notifier.sendMintingDeleted("agentVault", "requestId");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send minting was started", async () => {
        const spySend = spy.on(notifier, "sendMintingStared");
        notifier.sendMintingStared("agentVault", "requestId");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send redemption was started", async () => {
        const spySend = spy.on(notifier, "sendRedemptionStarted");
        notifier.sendRedemptionStarted("agentVault", "requestId");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send redemption was paid", async () => {
        const spySend = spy.on(notifier, "sendRedemptionPaid");
        notifier.sendRedemptionPaid("agentVault", "requestId");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send redemption payment proof was requested", async () => {
        const spySend = spy.on(notifier, "sendRedemptionRequestPaymentProof");
        notifier.sendRedemptionRequestPaymentProof("agentVault", "requestId");
        expect(spySend).to.have.been.called.once;
    });

});