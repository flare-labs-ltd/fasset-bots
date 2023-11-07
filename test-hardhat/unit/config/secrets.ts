import { expect } from "chai";
import { Secrets, requireSecret } from "../../../src/config/secrets";
import rewire from "rewire";
import { ENCRYPTION_PASSWORD_MIN_LENGTH } from "../../../src/utils/helpers";
const rewiredSecrets = rewire("../../../src/config/secrets");
const checkEncryptionPasswordLength = rewiredSecrets.__get__("checkEncryptionPasswordLength");

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
                apiKey: ""
            }
        }
        const fn1 = () => {
            return checkEncryptionPasswordLength(secrets);
        };
        expect(fn1).to.not.throw;
        secrets.wallet = {
            encryption_password: ""
        };
        const fn2 = () => {
            return checkEncryptionPasswordLength(secrets);
        };
        expect(fn2).to.throw(`'wallet.encryption_password' should be at least ${ENCRYPTION_PASSWORD_MIN_LENGTH} chars long`);
    });
});
