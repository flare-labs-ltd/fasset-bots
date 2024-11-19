import crypto from "crypto";

// the constants are same as the prefixes
export enum EncryptionMethod {
    // AES256-GCM with SHA256 key hashing (not secure, used for compatibility)
    AES_GCM_SHA = "",
    // AES256-GCM with SCRYPT key hashing, without authentication (used for compatibility)
    AES_GCM_SCRYPT = "@",
    // AES256-GCM with SCRYPT key hashing, with authentication (recommended - detects ciphertext corruption and wrong passwords)
    AES_GCM_SCRYPT_AUTH = "#",
}

export function encryptText(password: string, text: string, method: EncryptionMethod): string {
    const initVector = crypto.randomBytes(16);
    const passwordHash = createPasswordHash(method, password, initVector);
    const cipher = crypto.createCipheriv("aes-256-gcm", passwordHash, initVector, { authTagLength: 16 });
    const encrBuf = cipher.update(text, "utf-8");
    const encrBufFinal = cipher.final();
    if (method === EncryptionMethod.AES_GCM_SCRYPT_AUTH) {
        const authTag = cipher.getAuthTag();
        return method + Buffer.concat([initVector, authTag, encrBuf, encrBufFinal]).toString("base64");
    } else {
        return method + Buffer.concat([initVector, encrBuf, encrBufFinal]).toString("base64");
    }
}

export function decryptText(password: string, encText: string): string {
    const [method, encTextNoPrefix] = extractMethod(encText);
    const encrIvBuf = Buffer.from(encTextNoPrefix, "base64");
    const initVector = encrIvBuf.subarray(0, 16);
    const passwordHash = createPasswordHash(method, password, initVector);
    const cipher = crypto.createDecipheriv("aes-256-gcm", passwordHash, initVector, { authTagLength: 16 });
    if (method === EncryptionMethod.AES_GCM_SCRYPT_AUTH) {
        const authTag = encrIvBuf.subarray(16, 32);
        const encrBuf = encrIvBuf.subarray(32);
        cipher.setAuthTag(authTag);
        const decrBuf = cipher.update(encrBuf);
        const decrBufFinal = cipher.final();
        return Buffer.concat([decrBuf, decrBufFinal]).toString("utf-8");
    } else {
        const encrBuf = encrIvBuf.subarray(16);
        const decrBuf = cipher.update(encrBuf);
        return decrBuf.toString("utf-8");
    }
}

function extractMethod(encText: string): [method: EncryptionMethod, encTextNoPrefix: string] {
    if (encText.startsWith(EncryptionMethod.AES_GCM_SCRYPT_AUTH)) {
        return [EncryptionMethod.AES_GCM_SCRYPT_AUTH, encText.slice(1)];
    } else if (encText.startsWith(EncryptionMethod.AES_GCM_SCRYPT)) {
        return [EncryptionMethod.AES_GCM_SCRYPT, encText.slice(1)];
    } else {
        return [EncryptionMethod.AES_GCM_SHA, encText];
    }
}

function createPasswordHash(method: EncryptionMethod, password: string, salt: Buffer) {
    if (method !== EncryptionMethod.AES_GCM_SHA) {
        const N = 2 ** 15, r = 8, p = 1;    // provides ~100ms hash time
        const scryptOptions: crypto.ScryptOptions = { N, r, p, maxmem: 256 * N * r };
        return crypto.scryptSync(Buffer.from(password, "ascii"), salt, 32, scryptOptions);
    } else {
        return crypto.createHash("sha256").update(password, "ascii").digest();
    }
}
