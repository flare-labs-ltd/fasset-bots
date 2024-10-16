import { DogeAccount, DogeAccountGeneration } from "../../src";
import { expect } from "chai";
import WAValidator from "wallet-address-validator";

const fundedMnemonic = "involve essay clean frequent stumble cheese elite custom athlete rack obey walk";
const fundedAddress = "noXb5PiT85PPyQ3WBMLY7BUExm9KpfV93S";
const targetMnemonic = "forum tissue lonely diamond sea invest hill bamboo hamster leaf asset column duck order sock dad beauty valid staff scan hospital pair law cable";
const targetAddress = "npJo8FieqEmB1NehU4jFFEFPsdvy8ippbm";

describe("Dogecoin create account tests", () => {

    it("Should create account", async () => {
        const wClient = new DogeAccountGeneration(true);
        const newAccount = wClient.createWallet();
        expect(newAccount.address).to.not.be.null;

        const fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        expect(fundedWallet.address).to.eq(fundedAddress);
        const targetWallet = wClient.createWalletFromMnemonic(targetMnemonic);
        expect(targetWallet.address).to.eq(targetAddress);

        expect(WAValidator.validate(newAccount.address, "DOGE", "testnet")).to.be.true;
        expect(WAValidator.validate(fundedWallet.address, "DOGE", "testnet")).to.be.true;
        expect(WAValidator.validate(targetWallet.address, "DOGE", "testnet")).to.be.true;
    });

    it("Should create mainnet account", async () => {
        const wClient = new DogeAccount(false);
        const newAccount = wClient.createWallet();
        expect(newAccount.address).to.not.be.null;
        expect(WAValidator.validate(newAccount.address, "DOGE", "mainnet")).to.be.true;
    });

});
