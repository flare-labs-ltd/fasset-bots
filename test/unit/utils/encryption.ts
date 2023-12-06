import { assert } from "chai";
import { decryptText, encryptText } from "../../../src/utils/encryption";

describe("encryption unit tests", async () => {
    const plaintext = "this is plain text";
    const password = "this is password";

    it("Should encrypt and decrypt (hash pwd with sha256)", async () => {
        const encrypted = encryptText(password, plaintext, false);
        assert.isFalse(encrypted.startsWith("@"));
        const decrypted = decryptText(password, encrypted);
        assert.equal(decrypted, plaintext);
    });

    it("Should encrypt and decrypt (hash pwd with scrypt)", async () => {
        const encrypted = encryptText(password, plaintext, true);
        assert.isTrue(encrypted.startsWith("@"));
        const decrypted = decryptText(password, encrypted);
        assert.equal(decrypted, plaintext);
    });
});
