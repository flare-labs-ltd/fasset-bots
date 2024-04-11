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

describe("Notifier tests", () => {
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
        await notifier.send(NotificationLevel.INFO, AgentNotificationKey.ACTIVE_WITHDRAWAL, message);
        expect(spySend).to.have.been.called.with.exactly(NotificationLevel.INFO, AgentNotificationKey.ACTIVE_WITHDRAWAL, message);
    });

    it("Should send CCB alert", async () => {
        const spySend = spy.on(notifier, "sendCCBAlert");
        await notifier.sendCCBAlert("0");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send liquidation started alert", async () => {
        const spySend = spy.on(notifier, "sendLiquidationStartAlert");
        await notifier.sendLiquidationStartAlert("0");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send full liquidation alert", async () => {
        const spySend = spy.on(notifier, "sendFullLiquidationAlert");
        await notifier.sendFullLiquidationAlert("pay1", "pay2");
        await notifier.sendFullLiquidationAlert("pay1");
        await notifier.sendFullLiquidationAlert();
        expect(spySend).to.have.been.called.exactly(3);
    });

    it("Should send liquidation was performed alert", async () => {
        const spySend = spy.on(notifier, "sendLiquidationWasPerformed");
        await notifier.sendLiquidationWasPerformed("1000");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send minting corner case alert", async () => {
        const spySend = spy.on(transport, "send");
        await notifier.sendMintingIndexerExpired("id");
        await notifier.sendMintingPaymentProofRequested("id");
        await notifier.sendMintingNonPaymentProofRequested("id");
        expect(spySend).to.have.been.called.exactly(3);
    });

    it("Should send redemption corner case alert", async () => {
        const spySend = spy.on(notifier, "sendRedemptionExpiredInIndexer");
        await notifier.sendRedemptionExpiredInIndexer("id");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send redemption failed or blocked alert", async () => {
        const spySend = spy.on(transport, "send");
        await notifier.sendRedemptionFailed("reqId", "txHash", "redeemer", "reason");
        await notifier.sendRedemptionBlocked("reqId", "txHash", "redeemer");
        expect(spySend).to.have.been.called.twice;
    });

    it("Should send redemption defaulted alert", async () => {
        const spySend = spy.on(notifier, "sendRedemptionWasPerformed");
        await notifier.sendRedemptionWasPerformed("reqId", "redeemer");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send redemption was performed", async () => {
        const spySend = spy.on(notifier, "sendRedemptionDefaulted");
        await notifier.sendRedemptionDefaulted("reqId", "redeemer");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send top up collateral alert", async () => {
        const spySend = spy.on(transport, "send");
        await notifier.sendVaultCollateralTopUpAlert("1");
        await notifier.sendPoolCollateralTopUpAlert("1");
        expect(spySend).to.have.been.called.twice;
    });

    it("Should send top up collateral failed alert", async () => {
        const spySend = spy.on(transport, "send");
        await notifier.sendVaultCollateralTopUpFailedAlert("1");
        await notifier.sendPoolCollateralTopUpFailedAlert("1");
        expect(spySend).to.have.been.called.twice;
    });

    it("Should send low underlying balance failed alert", async () => {
        const spySend = spy.on(notifier, "sendLowUnderlyingAgentBalanceFailed");
        await notifier.sendLowUnderlyingAgentBalanceFailed("1");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send low underlying agent balance alert", async () => {
        const spySend = spy.on(notifier, "sendLowUnderlyingAgentBalance");
        await notifier.sendLowUnderlyingAgentBalance("1");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send low balance on owner's underlying address alert", async () => {
        const spySend = spy.on(notifier, "sendLowBalanceOnUnderlyingOwnersAddress");
        await notifier.sendLowBalanceOnUnderlyingOwnersAddress("underlying", "1");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send low balance on owner's address alert", async () => {
        const spySend = spy.on(notifier, "sendLowBalanceOnOwnersAddress");
        await notifier.sendLowBalanceOnOwnersAddress("ownerAddress", "1", "NAT");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send no proof obtained  alert", async () => {
        const spySend = spy.on(transport, "send");
        await notifier.sendRedemptionNoProofObtained("reqId", 1, "data");
        await notifier.sendMintingNoProofObtained("reqId", 1, "data");
        await notifier.sendDailyTaskNoProofObtained(1, "data");
        expect(spySend).to.have.been.called.exactly(3);
    });

    it("Should send agent destroyed  alert", async () => {
        const spySend = spy.on(notifier, "sendAgentDestroyed");
        await notifier.sendAgentDestroyed();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent created  alert", async () => {
        const spySend = spy.on(notifier, "sendAgentCreated");
        await notifier.sendAgentCreated();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent withdrew vault collateral collateral", async () => {
        const spySend = spy.on(notifier, "sendWithdrawVaultCollateral");
        await notifier.sendWithdrawVaultCollateral("100");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent updated  agent setting", async () => {
        const spySend = spy.on(notifier, "sendAgentSettingsUpdate");
        await notifier.sendAgentSettingsUpdate("settingName");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent exited  available", async () => {
        const spySend = spy.on(notifier, "sendAgentExitedAvailable");
        await notifier.sendAgentExitedAvailable();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent announced destruction", async () => {
        const spySend = spy.on(notifier, "sendAgentAnnounceDestroy");
        await notifier.sendAgentAnnounceDestroy();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent confirmed underlying withdrawal announcement", async () => {
        const spySend = spy.on(notifier, "sendConfirmWithdrawUnderlying");
        await notifier.sendConfirmWithdrawUnderlying();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent canceled underlying withdrawal announcement", async () => {
        const spySend = spy.on(notifier, "sendCancelWithdrawUnderlying");
        await notifier.sendCancelWithdrawUnderlying();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent redeemed pool tokens", async () => {
        const spySend = spy.on(notifier, "sendCollateralPoolTokensRedemption");
        await notifier.sendCollateralPoolTokensRedemption();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent bought pool tokens", async () => {
        const spySend = spy.on(notifier, "sendBuyCollateralPoolTokens");
        await notifier.sendBuyCollateralPoolTokens("amount");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send vault collateral was deposited to agent", async () => {
        const spySend = spy.on(notifier, "sendVaultCollateralDeposit");
        await notifier.sendVaultCollateralDeposit("amount");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send pool fees were withdrawn", async () => {
        const spySend = spy.on(notifier, "sendWithdrawPoolFees");
        await notifier.sendWithdrawPoolFees("amount");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send pool fees balance", async () => {
        const spySend = spy.on(notifier, "sendBalancePoolFees");
        await notifier.sendBalancePoolFees("amount");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent self closed", async () => {
        const spySend = spy.on(notifier, "sendSelfClose");
        await notifier.sendSelfClose();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send already active withdrawal", async () => {
        const spySend = spy.on(notifier, "sendActiveWithdrawal");
        await notifier.sendActiveWithdrawal();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send already no active withdrawal", async () => {
        const spySend = spy.on(notifier, "sendNoActiveWithdrawal");
        await notifier.sendNoActiveWithdrawal();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send underlying withdrawal was announced", async () => {
        const spySend = spy.on(notifier, "sendAnnounceUnderlyingWithdrawal");
        await notifier.sendAnnounceUnderlyingWithdrawal("paymentReference");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send underlying withdrawal was performed", async () => {
        const spySend = spy.on(notifier, "sendUnderlyingWithdrawalPerformed");
        await notifier.sendUnderlyingWithdrawalPerformed("txHash");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send minting was executed", async () => {
        const spySend = spy.on(notifier, "sendMintingExecuted");
        await notifier.sendMintingExecuted("requestId");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send minting was deleted", async () => {
        const spySend = spy.on(notifier, "sendMintingDeleted");
        await notifier.sendMintingDeleted("requestId");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send minting was started", async () => {
        const spySend = spy.on(notifier, "sendMintingStared");
        await notifier.sendMintingStarted("requestId");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send redemption was started", async () => {
        const spySend = spy.on(notifier, "sendRedemptionStarted");
        await notifier.sendRedemptionStarted("requestId");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send redemption was paid", async () => {
        const spySend = spy.on(notifier, "sendRedemptionPaid");
        await notifier.sendRedemptionPaid("requestId");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send redemption payment proof was requested", async () => {
        const spySend = spy.on(notifier, "sendRedemptionRequestPaymentProof");
        await notifier.sendRedemptionRequestPaymentProof("requestId");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send pool collateral delegated", async () => {
        const spySend = spy.on(notifier, "sendDelegatePoolCollateral");
        await notifier.sendDelegatePoolCollateral("pool", "recipient1", "1000");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send pool collateral undelegated", async () => {
        const spySend = spy.on(notifier, "sendUndelegatePoolCollateral");
        await notifier.sendUndelegatePoolCollateral("pool");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent setting update expired", async () => {
        const spySend = spy.on(notifier, "sendAgentCannotUpdateSettingExpired");
        await notifier.sendAgentCannotUpdateSettingExpired("setting");
        expect(spySend).to.have.been.called.once;
    });

    it("Should be unable to send request", async () => {
        const faultyNotifier = new FaultyNotifierTransport();
        const spyConsole = spy.on(console, "error");
        await faultyNotifier.send(BotType.AGENT, "test", NotificationLevel.INFO, "test", "test");
        expect(spyConsole).to.have.been.called.once;
    });

    it("Should send illegal transaction challenge", async () => {
        const notifier = new ChallengerNotifier("challenger", [transport]);
        const spySend = spy.on(notifier, "sendIllegalTransactionChallenge");
        await notifier.sendIllegalTransactionChallenge("agentVault", "txHash");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send double payment challenge", async () => {
        const notifier = new ChallengerNotifier("challenger", [transport]);
        const spySend = spy.on(notifier, "sendDoublePaymentChallenge");
        await notifier.sendDoublePaymentChallenge("agentVault", "txHash1", "txHash2");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send free balance negative", async () => {
        const notifier = new ChallengerNotifier("challenger", [transport]);
        const spySend = spy.on(notifier, "sendFreeBalanceNegative");
        await notifier.sendFreeBalanceNegative("agentVault");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send agent liquidated", async () => {
        const notifier = new LiquidatorNotifier("liquidator", [transport]);
        const spySend = spy.on(notifier, "sendAgentLiquidated");
        await notifier.sendAgentLiquidated("agentVault");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send redemption of collateral pool tokens was announced", async () => {
        const spySend = spy.on(notifier, "sendRedeemCollateralPoolTokensAnnouncement");
        await notifier.sendRedeemCollateralPoolTokensAnnouncement("amount");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send cannot withdraw collateral", async () => {
        const spySend = spy.on(notifier, "sendAgentCannotWithdrawCollateral");
        await notifier.sendAgentCannotWithdrawCollateral("amount", "POOL");
        expect(spySend).to.have.been.called.once;
    });

    it("Should send cancel vault collateral withdrawal announcement", async () => {
        const spySend = spy.on(notifier, "sendCancelVaultCollateralAnnouncement");
        await notifier.sendCancelVaultCollateralAnnouncement();
        expect(spySend).to.have.been.called.once;
    });

    it("Should send pool token redemption announcement", async () => {
        const spySend = spy.on(notifier, "sendCancelRedeemCollateralPoolTokensAnnouncement");
        await notifier.sendCancelRedeemCollateralPoolTokensAnnouncement();
        expect(spySend).to.have.been.called.once;
    });
});
