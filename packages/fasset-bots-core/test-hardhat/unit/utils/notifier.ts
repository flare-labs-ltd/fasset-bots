import { expect, spy, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import spies from "chai-spies";
import { MockNotifierTransport } from "../../../src/mock/MockNotifierTransport";
import { AgentNotificationKey, AgentNotifier } from "../../../src/utils/notifier/AgentNotifier";
import { BotType, NotificationLevel } from "../../../src/utils/notifier/BaseNotifier";
import { ChallengerNotifier } from "../../../src/utils/notifier/ChallengerNotifier";
import { LiquidatorNotifier } from "../../../src/utils/notifier/LiquidatorNotifier";
import { FaultyNotifierTransport } from "../../test-utils/FaultyNotifierTransport";
use(chaiAsPromised);
use(spies);

const message = "MESSAGE";

describe("Notifier tests",  () => {
    let transport: MockNotifierTransport;
    let notifier: AgentNotifier;

    beforeEach(() => {
        transport = new MockNotifierTransport();
        notifier = new AgentNotifier("agentVault", [transport]);
    });

    afterEach(function () {
        spy.restore(notifier);
        spy.restore(console);
    });

    it("Should send custom message", async () => {
        const spySend = spy.on(notifier, "send");
        notifier.send(NotificationLevel.INFO, AgentNotificationKey.ACTIVE_WITHDRAWAL, message);
        expect(spySend).to.have.been.called.with.exactly(NotificationLevel.INFO, AgentNotificationKey.ACTIVE_WITHDRAWAL, message);
    });

    it("Should send CCB alert", async () => {
        const spySend = spy.on(notifier, "sendCCBAlert");
        notifier.sendCCBAlert("0");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send liquidation started alert", async () => {
        const spySend = spy.on(notifier, "sendLiquidationStartAlert");
        notifier.sendLiquidationStartAlert("0");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send full liquidation alert", async () => {
        const spySend = spy.on(notifier, "sendFullLiquidationAlert");
        notifier.sendFullLiquidationAlert("pay1", "pay2");
        notifier.sendFullLiquidationAlert("pay1");
        notifier.sendFullLiquidationAlert();
        expect(spySend).to.have.been.called.exactly(3);
    });

    it("Should send liquidation was performed alert", async () => {
        const spySend = spy.on(notifier, "sendLiquidationWasPerformed");
        notifier.sendLiquidationWasPerformed("1000");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send minting corner case alert", async () => {
        const spySend = spy.on(transport, "send");
        notifier.sendMintingIndexerExpired("id");
        notifier.sendMintingPaymentProofRequested("id");
        notifier.sendMintingNonPaymentProofRequested("id");
        expect(spySend).to.have.been.called.exactly(3);
    });

    it("Should send redemption corner case alert", async () => {
        const spySend = spy.on(notifier, "sendRedemptionExpiredInIndexer");
        notifier.sendRedemptionExpiredInIndexer("id");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send redemption failed or blocked alert", async () => {
        const spySend = spy.on(transport, "send");
        notifier.sendRedemptionFailed("reqId", "txHash", "redeemer", "reason");
        notifier.sendRedemptionBlocked("reqId", "txHash", "redeemer");
        expect(spySend).to.have.been.called.twice;
    });

    it("Should send redemption defaulted alert", async () => {
        const spySend = spy.on(notifier, "sendRedemptionWasPerformed");
        notifier.sendRedemptionWasPerformed("reqId", "redeemer");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send redemption was performed", async () => {
        const spySend = spy.on(notifier, "sendRedemptionDefaulted");
        notifier.sendRedemptionDefaulted("reqId", "redeemer");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send top up collateral alert", async () => {
        const spySend = spy.on(transport, "send");
        notifier.sendVaultCollateralTopUpAlert("1");
        notifier.sendPoolCollateralTopUpAlert("1");
        expect(spySend).to.have.been.called.twice;
    });

    it("Should send top up collateral failed alert", async () => {
        const spySend = spy.on(transport, "send");
        notifier.sendVaultCollateralTopUpFailedAlert("1");
        notifier.sendPoolCollateralTopUpFailedAlert("1");
        expect(spySend).to.have.been.called.twice;
    });

    it("Should send low underlying balance failed alert", async () => {
        const spySend = spy.on(notifier, "sendLowUnderlyingAgentBalanceFailed");
        notifier.sendLowUnderlyingAgentBalanceFailed("1");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send low underlying agent balance alert", async () => {
        const spySend = spy.on(notifier, "sendLowUnderlyingAgentBalance");
        notifier.sendLowUnderlyingAgentBalance("1");
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
        const spySend = spy.on(transport, "send");
        notifier.sendRedemptionNoProofObtained("reqId", 1, "data");
        notifier.sendMintingNoProofObtained("reqId", 1, "data");
        notifier.sendDailyTaskNoProofObtained(1, "data");
        expect(spySend).to.have.been.called.exactly(3);
    });

    it("Should send agent destroyed  alert", async () => {
        const spySend = spy.on(notifier, "sendAgentDestroyed");
        notifier.sendAgentDestroyed();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent created  alert", async () => {
        const spySend = spy.on(notifier, "sendAgentCreated");
        notifier.sendAgentCreated();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent withdrew vault collateral collateral", async () => {
        const spySend = spy.on(notifier, "sendWithdrawVaultCollateral");
        notifier.sendWithdrawVaultCollateral("100");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent updated  agent setting", async () => {
        const spySend = spy.on(notifier, "sendAgentSettingsUpdate");
        notifier.sendAgentSettingsUpdate("settingName");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent exited  available", async () => {
        const spySend = spy.on(notifier, "sendAgentExitedAvailable");
        notifier.sendAgentExitedAvailable();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent announced destruction", async () => {
        const spySend = spy.on(notifier, "sendAgentAnnounceDestroy");
        notifier.sendAgentAnnounceDestroy();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent confirmed underlying withdrawal announcement", async () => {
        const spySend = spy.on(notifier, "sendConfirmWithdrawUnderlying");
        notifier.sendConfirmWithdrawUnderlying();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent canceled underlying withdrawal announcement", async () => {
        const spySend = spy.on(notifier, "sendCancelWithdrawUnderlying");
        notifier.sendCancelWithdrawUnderlying();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent redeemed pool tokens", async () => {
        const spySend = spy.on(notifier, "sendCollateralPoolTokensRedemption");
        notifier.sendCollateralPoolTokensRedemption();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent bought pool tokens", async () => {
        const spySend = spy.on(notifier, "sendBuyCollateralPoolTokens");
        notifier.sendBuyCollateralPoolTokens("amount");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send vault collateral was deposited to agent", async () => {
        const spySend = spy.on(notifier, "sendVaultCollateralDeposit");
        notifier.sendVaultCollateralDeposit("amount");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send pool fees were withdrawn", async () => {
        const spySend = spy.on(notifier, "sendWithdrawPoolFees");
        notifier.sendWithdrawPoolFees("amount");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send pool fees balance", async () => {
        const spySend = spy.on(notifier, "sendBalancePoolFees");
        notifier.sendBalancePoolFees("amount");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent self closed", async () => {
        const spySend = spy.on(notifier, "sendSelfClose");
        notifier.sendSelfClose();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send already active withdrawal", async () => {
        const spySend = spy.on(notifier, "sendActiveWithdrawal");
        notifier.sendActiveWithdrawal();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send already no active withdrawal", async () => {
        const spySend = spy.on(notifier, "sendNoActiveWithdrawal");
        notifier.sendNoActiveWithdrawal();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send underlying withdrawal was announced", async () => {
        const spySend = spy.on(notifier, "sendAnnounceUnderlyingWithdrawal");
        notifier.sendAnnounceUnderlyingWithdrawal("paymentReference");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send underlying withdrawal was performed", async () => {
        const spySend = spy.on(notifier, "sendUnderlyingWithdrawalPerformed");
        notifier.sendUnderlyingWithdrawalPerformed("txHash");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send minting was executed", async () => {
        const spySend = spy.on(notifier, "sendMintingExecuted");
        notifier.sendMintingExecuted("requestId");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send minting was deleted", async () => {
        const spySend = spy.on(notifier, "sendMintingDeleted");
        notifier.sendMintingDeleted("requestId");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send minting was started", async () => {
        const spySend = spy.on(notifier, "sendMintingStared");
        notifier.sendMintingStared("requestId");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send redemption was started", async () => {
        const spySend = spy.on(notifier, "sendRedemptionStarted");
        notifier.sendRedemptionStarted("requestId");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send redemption was paid", async () => {
        const spySend = spy.on(notifier, "sendRedemptionPaid");
        notifier.sendRedemptionPaid("requestId");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send redemption payment proof was requested", async () => {
        const spySend = spy.on(notifier, "sendRedemptionRequestPaymentProof");
        notifier.sendRedemptionRequestPaymentProof("requestId");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send pool collateral delegated", async () => {
        const spySend = spy.on(notifier, "sendDelegatePoolCollateral");
        notifier.sendDelegatePoolCollateral("pool", "recipient1", "1000");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send pool collateral undelegated", async () => {
        const spySend = spy.on(notifier, "sendUndelegatePoolCollateral");
        notifier.sendUndelegatePoolCollateral("pool");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent setting update expired", async () => {
        const spySend = spy.on(notifier, "sendAgentCannotUpdateSettingExpired");
        notifier.sendAgentCannotUpdateSettingExpired("setting");
        expect(spySend).to.have.been.called.once;
    });

    it("Should be unable to send request", async () => {
        let faultyNotifier = new FaultyNotifierTransport();
        const spyConsole = spy.on(console, "error");
        await faultyNotifier.send(BotType.AGENT, "test", NotificationLevel.INFO, "test", "test");
        expect(spyConsole).to.have.been.called.once;
    });

    it("Should send illegal transaction challenge", async () => {
        const notifier = new ChallengerNotifier("challenger", [transport]);
        const spySend = spy.on(notifier, "sendIllegalTransactionChallenge");
        notifier.sendIllegalTransactionChallenge("agentVault", "txHash");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send double payment challenge", async () => {
        const notifier = new ChallengerNotifier("challenger", [transport]);
        const spySend = spy.on(notifier, "sendDoublePaymentChallenge");
        notifier.sendDoublePaymentChallenge("agentVault", "txHash1", "txHash2");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send free balance negative", async () => {
        const notifier = new ChallengerNotifier("challenger", [transport]);
        const spySend = spy.on(notifier, "sendFreeBalanceNegative");
        notifier.sendFreeBalanceNegative("agentVault");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent liquidated", async () => {
        const notifier = new LiquidatorNotifier("liquidator", [transport]);
        const spySend = spy.on(notifier, "sendAgentLiquidated");
        notifier.sendAgentLiquidated("agentVault");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send redemption of collateral pool tokens was announced", async () => {
        const spySend = spy.on(notifier, "sendRedeemCollateralPoolTokensAnnouncement");
        notifier.sendRedeemCollateralPoolTokensAnnouncement("amount");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send cannot withdraw collateral", async () => {
        const spySend = spy.on(notifier, "sendAgentCannotWithdrawCollateral");
        notifier.sendAgentCannotWithdrawCollateral("amount", "POOL");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send cancel vault collateral withdrawal announcement", async () => {
        const spySend = spy.on(notifier, "sendCancelVaultCollateralAnnouncement");
        notifier.sendCancelVaultCollateralAnnouncement();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send pool token redemption announcement", async () => {
        const spySend = spy.on(notifier, "sendCancelRedeemCollateralPoolTokensAnnouncement");
        notifier.sendCancelRedeemCollateralPoolTokensAnnouncement();
        expect(spySend).to.have.been.called.once;
    });
});
