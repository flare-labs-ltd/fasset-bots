import { expect } from "chai";
import { PaymentReference } from "../../../src/fasset/PaymentReference";
import { toBN, toHex } from "../../../src/utils/helpers";


describe("Payment reference unit tests", async () => {

    const id = 5;
    const address = "";

    it("Should get minting reference", () => {
        const mintingRef = PaymentReference.minting(id);
        const expected = toHex(toBN(id).or(PaymentReference.MINTING), 32);
        expect(mintingRef).to.eq(expected);
    });

    it("Should get redemption reference", () => {
        const redemptionRef = PaymentReference.redemption(id);
        const expected = toHex(toBN(id).or(PaymentReference.REDEMPTION), 32);
        expect(redemptionRef).to.eq(expected);
    });

    it("Should get announced withdrawal reference", () => {
        const announcedWithdrawalRef = PaymentReference.announcedWithdrawal(id);
        const expected = toHex(toBN(id).or(PaymentReference.ANNOUNCED_WITHDRAWAL), 32);
        expect(announcedWithdrawalRef).to.eq(expected);
    });

    it("Should get topup reference", () => {
        const topupRef = PaymentReference.topup(address);
        const expected = toHex(toBN(address).or(PaymentReference.TOPUP), 32);
        expect(topupRef).to.eq(expected);
    });

    it("Should get selfMint reference", () => {
        const selfMintRef = PaymentReference.selfMint(address);
        const expected = toHex(toBN(address).or(PaymentReference.SELF_MINT), 32);
        expect(selfMintRef).to.eq(expected);
    });

    it("Should get address ownership reference", () => {
        const addressOwnershipRef = PaymentReference.addressOwnership(address);
        const expected = toHex(toBN(address).or(PaymentReference.ADDRESS_OWNERSHIP), 32);
        expect(addressOwnershipRef).to.eq(expected);
    });

});