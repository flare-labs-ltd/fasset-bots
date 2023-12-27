import { expect } from "chai";
import { Secrets, getSecrets, requireEncryptionPassword, requireSecret, resetSecrets } from "../../../src/config/secrets";
import { ENCRYPTION_PASSWORD_MIN_LENGTH, requireEnv } from "../../../src/utils/helpers";

describe("Secrets unit tests", async () => {
    it("Should not return secret", async () => {
        const secretName = "wallet";
        const fn = () => {
            return requireSecret(secretName);
        };
        expect(fn).to.throw(`Secret variable ${secretName} not defined or not typeof string`);
    });

    it("Should not return secret 2", async () => {
        const address = requireSecret("owner.underlying_address");
        const secretName = "owner.underlying_address." + address + "." + address;
        const fn = () => {
            return requireSecret(secretName);
        };
        expect(fn).to.throw(`Secret variable ${secretName} not defined or not typeof string`);
    });

    it("Should throw error if encryption password too short", async () => {
        const secrets: Secrets = {
            apiKey: {
                apiKey: "",
            },
        };
        const fn1 = () => {
            return requireEncryptionPassword("wallet.encryption_password", secrets);
        };
        expect(fn1).to.throw("Secret variable wallet.encryption_password not defined or not typeof string");

        secrets.wallet = undefined;
        const fn2 = () => {
            return requireEncryptionPassword("wallet.encryption_password", secrets);
        };
        expect(fn2).to.throw("Secret variable wallet.encryption_password not defined or not typeof string");

        secrets.wallet = {
            encryption_password: "",
        };
        const fn3 = () => {
            return requireEncryptionPassword("wallet.encryption_password", secrets);
        };
        expect(fn3).to.throw(`'wallet.encryption_password' should be at least ${ENCRYPTION_PASSWORD_MIN_LENGTH} chars long`);

        secrets.wallet = {
            encryption_password: "123456789012345",
        };
        const fn4 = () => {
            return requireEncryptionPassword("wallet.encryption_password", secrets);
        };
        expect(fn4).to.throw(`'wallet.encryption_password' should be at least ${ENCRYPTION_PASSWORD_MIN_LENGTH} chars long`);
    });

    it("Should reset secrets", async () => {
        resetSecrets(null);
        const secrets = getSecrets();
        expect(secrets.apiKey).to.be.empty;
        resetSecrets(requireEnv("FASSET_SECRETS"));
        const secrets2 = getSecrets();
        expect(secrets2.apiKey).to.not.be.empty;
    });
});
