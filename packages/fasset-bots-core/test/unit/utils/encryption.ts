import { assert } from "chai";
import crypto from "crypto";
import { decryptText, EncryptionMethod, encryptText } from "@flarelabs/simple-wallet";

describe("encryption unit tests", () => {
    const plaintext = "this is plain text";
    const password = "this is password";
    const wrongPassword = "this is wrong password";

    it("Should encrypt and decrypt (hash pwd with scrypt)", async () => {
        const encrypted = encryptText(password, plaintext, EncryptionMethod.AES_GCM_SCRYPT);
        assert.isTrue(encrypted.startsWith("@"));
        const decrypted = decryptText(password, encrypted);
        assert.equal(decrypted, plaintext);
    });

    it("Should encrypt and decrypt (authenticated, hash pwd with scrypt)", async () => {
        const encrypted = encryptText(password, plaintext, EncryptionMethod.AES_GCM_SCRYPT_AUTH);
        assert.isTrue(encrypted.startsWith("#"));
        const decrypted = decryptText(password, encrypted);
        assert.equal(decrypted, plaintext);
    });

    it("Should fail decrypt with wrong password (authenticated)", async () => {
        const encrypted = encryptText(password, plaintext, EncryptionMethod.AES_GCM_SCRYPT_AUTH);
        assert.isTrue(encrypted.startsWith("#"));
        assert.throws(() => decryptText(wrongPassword, encrypted), "Unsupported state or unable to authenticate data");
    });

    it("Should fail decrypt with invalid prefix", async () => {
        const encrypted = "24352174abcdf";
        assert.isFalse(encrypted.startsWith("@"));
        assert.isFalse(encrypted.startsWith("#"));
        assert.throws(() => decryptText(password, encrypted), "Invalid encrypted text format");
    });

    function encryptTextOld(password: string, text: string, useScrypt: boolean): string {
        const initVector = crypto.randomBytes(16);
        const passwordHash = createPasswordHashOld(useScrypt, password, initVector);
        const cipher = crypto.createCipheriv("aes-256-gcm", passwordHash, initVector);
        const encBuf = cipher.update(text, "utf-8");
        const prefix = useScrypt ? "@" : "";
        return prefix + Buffer.concat([initVector, encBuf]).toString("base64");
    }

    function createPasswordHashOld(useScrypt: boolean, password: string, salt: Buffer) {
        if (useScrypt) {
            const N = 2 ** 15, r = 8, p = 1;    // provides ~100ms hash time
            const scryptOptions: crypto.ScryptOptions = { N, r, p, maxmem: 256 * N * r };
            return crypto.scryptSync(Buffer.from(password, "ascii"), salt, 32, scryptOptions);
        } else {
            return crypto.createHash("sha256").update(password, "ascii").digest();
        }
    }

    it("Should be backward compatible (hash pwd with scrypt)", async () => {
        const encrypted = encryptTextOld(password, plaintext, true);
        assert.isTrue(encrypted.startsWith("@"));
        const decrypted = decryptText(password, encrypted);
        assert.equal(decrypted, plaintext);
    });
});
