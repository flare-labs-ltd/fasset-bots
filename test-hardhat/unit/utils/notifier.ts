import { Notifier } from "../../../src/utils/Notifier";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chai = require('chai');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const spies = require('chai-spies');
chai.use(spies);
const expect = chai.expect;
// eslint-disable-next-line @typescript-eslint/no-var-requires
chai.use(require("chai-as-promised"));

const title = "TITLE";
const message = "MESSAGE";
describe("Notifier tests", async () => {
    let notifier: Notifier;

    beforeEach(() => {
        notifier = new Notifier();
    });

    afterEach(function () {
        chai.spy.restore(notifier);
    });

    it("Should send custom message", async () => {
        const spy = chai.spy.on(notifier, "send");
        notifier.send(title, message);
        expect(spy).to.have.been.called.with.exactly(title, message);
    });

    it("Should send custom message 2", async () => {
        const spy = chai.spy.on(notifier, "send");
        const title = "TITLE";
        notifier.send(title);
        expect(spy).to.have.been.called.with.exactly(title);
    });

    it("Should send CCB alert", async () => {
        const spy = chai.spy.on(notifier, "sendCCBAlert");
        notifier.sendCCBAlert("agentVault");
        expect(spy).to.have.been.called.once;
    });

    it("Should send liquidation started alert", async () => {
        const spy = chai.spy.on(notifier, "sendLiquidationStartAlert");
        notifier.sendLiquidationStartAlert("agentVault");
        expect(spy).to.have.been.called.once;
    });


    it("Should send full liquidation alert", async () => {
        const spy = chai.spy.on(notifier, "sendFullLiquidationAlert");
        notifier.sendFullLiquidationAlert("agentVault", "pay1", "pay2");
        notifier.sendFullLiquidationAlert("agentVault", "pay1");
        notifier.sendFullLiquidationAlert("agentVault");
        expect(spy).to.have.been.called.exactly(3);
    });

    it("Should send liquidation was performed alert", async () => {
        const spy = chai.spy.on(notifier, "sendLiquidationWasPerformed");
        notifier.sendLiquidationWasPerformed("agentVault");
        expect(spy).to.have.been.called.once;
    });

    it("Should send minting corner case alert", async () => {
        const spy = chai.spy.on(notifier, "sendMintingCornerCase");
        notifier.sendMintingCornerCase("agentVault");
        notifier.sendMintingCornerCase("agentVault", true);
        expect(spy).to.have.been.called.twice;
    });

    it("Should send redemption corner case alert", async () => {
        const spy = chai.spy.on(notifier, "sendRedemptionCornerCase");
        notifier.sendRedemptionCornerCase("agentVault");
        expect(spy).to.have.been.called.once;
    });

    it("Should send redemption failed or blocked alert", async () => {
        const spy = chai.spy.on(notifier, "sendRedemptionFailedOrBlocked");
        notifier.sendRedemptionFailedOrBlocked("reqId", "txHash", "redeemer", "reason");
        notifier.sendRedemptionFailedOrBlocked("reqId", "txHash", "redeemer");
        expect(spy).to.have.been.called.twice;
    });

    it("Should send redemption defaulted alert", async () => {
        const spy = chai.spy.on(notifier, "sendRedemptionDefaulted");
        notifier.sendRedemptionDefaulted("reqId", "txHash", "redeemer");
        expect(spy).to.have.been.called.once;
    });

    it("Should send top up collateral alert", async () => {
        const spy = chai.spy.on(notifier, "sendCollateralTopUpAlert");
        notifier.sendCollateralTopUpAlert("agentVault", "1");
        expect(spy).to.have.been.called.once;
    });

    it("Should send top up collateral failed alert", async () => {
        const spy = chai.spy.on(notifier, "sendCollateralTopUpFailedAlert");
        notifier.sendCollateralTopUpFailedAlert("agentVault", "1");
        expect(spy).to.have.been.called.once;
    });

    it("Should send low underlying balance failed alert", async () => {
        const spy = chai.spy.on(notifier, "sendLowUnderlyingAgentBalanceFailed");
        notifier.sendLowUnderlyingAgentBalanceFailed("agentVault", "1");
        expect(spy).to.have.been.called.once;
    });

    it("Should send low underlying agent balance alert", async () => {
        const spy = chai.spy.on(notifier, "sendLowUnderlyingAgentBalance");
        notifier.sendLowUnderlyingAgentBalance("agentVault", "1");
        expect(spy).to.have.been.called.once;
    });

    it("Should send low balance on owner's underlying address alert", async () => {
        const spy = chai.spy.on(notifier, "sendLowBalanceOnUnderlyingOwnersAddress");
        notifier.sendLowBalanceOnUnderlyingOwnersAddress("underlying", "1");
        expect(spy).to.have.been.called.once;
    });

    it("Should send low balance on owner's address alert", async () => {
        const spy = chai.spy.on(notifier, "sendLowBalanceOnOwnersAddress");
        notifier.sendLowBalanceOnOwnersAddress("ownerAddress", "1");
        expect(spy).to.have.been.called.once;
    });

    it("Should send no proof obtained  alert", async () => {
        const spy = chai.spy.on(notifier, "sendNoProofObtained");
        notifier.sendNoProofObtained("agentVault", "reqId", 1,  "data", true);
        notifier.sendNoProofObtained("agentVault", "reqId", 1, "data");
        expect(spy).to.have.been.called.twice;
    });

});