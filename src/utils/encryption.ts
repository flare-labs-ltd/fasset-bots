import crypto from "crypto";

export function encryptText(password: string, text: string, useScrypt: boolean): string {
    const initVector = crypto.randomBytes(16);
    const passwordHash = createPasswordHash(useScrypt, password, initVector);
    const cipher = crypto.createCipheriv("aes-256-gcm", passwordHash, initVector);
    const encBuf = cipher.update(text, "utf-8");
    // mark scrypt based encryption with '@' to keep compatibility (sha256 hashes are only used in some testnet beta bots)
    // '@' does not appear in base64 encoding, so this is not ambigous
    const prefix = useScrypt ? "@" : "";
    return prefix + Buffer.concat([initVector, encBuf]).toString("base64");
}

export function decryptText(password: string, encText: string): string {
    const encIvBuf = Buffer.from(encText.replace(/^@/, ''), "base64");
    const initVector = encIvBuf.subarray(0, 16);
    const encBuf = encIvBuf.subarray(16);
    const useScrypt = encText.startsWith("@");  // '@' marks password hashing with scrypt
    const passwordHash = createPasswordHash(useScrypt, password, initVector);
    const cipher = crypto.createDecipheriv("aes-256-gcm", passwordHash, initVector);
    return cipher.update(encBuf).toString("utf-8");
}

function createPasswordHash(useScrypt: boolean, password: string, salt: Buffer) {
    if (useScrypt) {
        const N = 2 ** 15, r = 8, p = 1;    // provides ~100ms hash time
        const scryptOptions: crypto.ScryptOptions = { N, r, p, maxmem: 256 * N * r };
        return crypto.scryptSync(Buffer.from(password, "ascii"), salt, 32, scryptOptions);
    } else {
        return crypto.createHash("sha256").update(password, "ascii").digest();
    }
}
