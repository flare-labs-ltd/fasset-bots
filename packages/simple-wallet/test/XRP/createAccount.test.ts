import { WALLET, XrpAccountGeneration } from "../../src";
import { expect } from "chai";
import WAValidator from "wallet-address-validator";


const fundedSeed = "sannPkA1sGXzM1MzEZBjrE1TDj4Fr";
const fundedAddress = "rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8";
const targetMnemonic = "involve essay clean frequent stumble cheese elite custom athlete rack obey walk";
const targetAddress = "r4CrUeY9zcd4TpndxU5Qw9pVXfobAXFWqq";
const entropyBase = "my_xrp_test_wallet";
const entropyBasedAddress = "rMeXpc8eokNRCTVtCMjFqTKdyRezkYJAi1";

describe("Xrp create account tests", () => {

    it("Should create account", async () => {
        const wClient = new XrpAccountGeneration(true);
        const newAccount = wClient.createWallet();
        expect(newAccount.address).to.not.be.null;
        const targetAccount = wClient.createWalletFromMnemonic(targetMnemonic);
        expect(targetAccount.address).to.equal(targetAddress);
        expect(WAValidator.validate(newAccount.address, "XRP", "testnet")).to.be.true;
        expect(WAValidator.validate(targetAccount.address, "XRP", "testnet")).to.be.true;
    });

    it("Should create account 2", async () => {
        const wClient = new WALLET.XrpAccount(true);
        const newAccount = wClient.createWalletFromEntropy(Buffer.from(entropyBase), "ecdsa-secp256k1");
        expect(newAccount.address).to.equal(entropyBasedAddress);
        expect(WAValidator.validate(newAccount.address, "XRP", "testnet")).to.be.true;
    });

    it("Should create account 3", async () => {
        const wClient = new XrpAccountGeneration(true);
        const fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        expect(fundedWallet.address).to.equal(fundedAddress);
        expect(WAValidator.validate(fundedWallet.address, "XRP", "testnet")).to.be.true;
    });

    it("Should create mainnet account", async () => {
        const wClient = new XrpAccountGeneration(false);
        const newAccount = wClient.createWallet();
        expect(newAccount.address).to.not.be.null;
        expect(WAValidator.validate(newAccount.address, "XRP", "mainnet")).to.be.true;
    });
});
