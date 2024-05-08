import { expect } from "chai";
import { ChainId } from "../../../src";
import { ENCRYPTION_PASSWORD_MIN_LENGTH, Secrets } from "../../../src/config/secrets";
import { requireEnv } from "../../../src/utils/helpers";

const chainId = ChainId.testXRP;

describe("Secrets unit tests", () => {
    it("Should not return secret", async () => {
        const secrets = new Secrets("no_file.json", { apiKey: {} });
        const secretName = "wallet";
        const fn = () => {
            return secrets.required(secretName);
        };
        expect(fn).to.throw(`Secret variable ${secretName} not defined or not typeof string`);
    });

    it("Should not return secret 2", async () => {
        const secrets = new Secrets("no_file.json", { apiKey: {}, owner: { testXRP: { address: "0xabcd", private_key: "0xabcd" } } });
        const address = secrets.required(`owner.${chainId.chainName}.address`);
        const secretName = `owner.${chainId}.address.` + address + "." + address;
        const fn = () => {
            return secrets.required(secretName);
        };
        expect(fn).to.throw(`Secret variable ${secretName} not defined or not typeof string`);
    });

    it("Should throw error if encryption password too short", async () => {
        const walletPassword = "wallet.encryption_password";
        const secrets = new Secrets("no_file.json", { apiKey: {} });
        const fn1 = () => {
            return secrets.requiredEncryptionPassword(walletPassword);
        };
        expect(fn1).to.throw("Secret variable wallet.encryption_password not defined or not typeof string");

        secrets.data.wallet = undefined;
        const fn2 = () => {
            return secrets.requiredEncryptionPassword(walletPassword);
        };
        expect(fn2).to.throw("Secret variable wallet.encryption_password not defined or not typeof string");

        secrets.data.wallet = {
            encryption_password: "",
        };
        const fn3 = () => {
            return secrets.requiredEncryptionPassword(walletPassword);
        };
        expect(fn3).to.throw(`'wallet.encryption_password' should be at least ${ENCRYPTION_PASSWORD_MIN_LENGTH} chars long`);

        secrets.data.wallet = {
            encryption_password: "123456789012345",
        };
        const fn4 = () => {
            return secrets.requiredEncryptionPassword(walletPassword);
        };
        expect(fn4).to.throw(`'wallet.encryption_password' should be at least ${ENCRYPTION_PASSWORD_MIN_LENGTH} chars long`);
    });

    it("Should load secrets", async () => {
        const secrets2 = Secrets.load(requireEnv("FASSET_BOT_SECRETS"));
        expect(secrets2.data.apiKey).to.not.be.empty;
    });
});
