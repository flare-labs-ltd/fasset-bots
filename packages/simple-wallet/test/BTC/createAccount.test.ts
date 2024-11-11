import { BtcAccount, BtcAccountGeneration } from "../../src";
import { expect } from "chai";
import WAValidator from "wallet-address-validator";
import { UTXOAccountGeneration } from "../../src/chain-clients/account-generation/UTXOAccountGeneration";
import { ChainType } from "../../src/utils/constants";

const fundedMnemonic = "theme damage online elite clown fork gloom alpha scorpion welcome ladder camp rotate cheap gift stone fog oval soda deputy game jealous relax muscle";
const fundedAddress = "tb1qyghw9dla9vl0kutujnajvl6eyj0q2nmnlnx3j0";
const targetMnemonic = "forget fine shop cage build else tree hurry upon sure diary multiply despair skirt hill mango hurdle first screen skirt kind fresh scene prize";
const targetAddress = "tb1q8j7jvsdqxm5e27d48p4382xrq0emrncwfr35k4";


describe("Bitcoin create account tests", () => {

    it("Should create testnet accounts", () => {
        const testClient = new BtcAccount(true);
        const newAccount = testClient.createWallet();
        expect(newAccount.address).to.not.be.null;
        expect(WAValidator.validate(newAccount.address, "BTC", "testnet")).to.be.true;

        const fundedWallet = testClient.createWalletFromMnemonic(fundedMnemonic);
        expect(fundedWallet.address).to.eq(fundedAddress);
        expect(WAValidator.validate(fundedWallet.address, "BTC", "testnet")).to.be.true;

        const targetWallet = testClient.createWalletFromMnemonic(targetMnemonic);
        expect(targetWallet.address).to.eq(targetAddress);
        expect(WAValidator.validate(targetWallet.address, "BTC", "testnet")).to.be.true;
    });

    it("Should create mainnet account", () => {
        const testClient = new BtcAccountGeneration(false);
        const newAccount = testClient.createWallet();
        expect(newAccount.address).to.not.be.null;
        expect(WAValidator.validate(newAccount.address, "BTC", "mainnet")).to.be.true;
    });

    it("Should not create account - invalid chainType", () => {
        const testClient = new UTXOAccountGeneration(ChainType.testXRP);
        const fn1 = () => {
            return testClient.createWallet();
        };
        expect(fn1).to.throw("Invalid chainType testXRP");
    });
});
