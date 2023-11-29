import crypto from "crypto";

export function encryptText(password: string, text: string): string {
    const passwordHash = crypto.createHash("sha256").update(password, "ascii").digest();
    const initVector = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", passwordHash, initVector);
    const encBuf = cipher.update(text, "utf-8");
    return Buffer.concat([initVector, encBuf]).toString("base64");
}

export function decryptText(password: string, encText: string): string {
    const passwordHash = crypto.createHash("sha256").update(password, "ascii").digest();
    const encIvBuf = Buffer.from(encText, "base64");
    const initVector = encIvBuf.subarray(0, 16);
    const encBuf = encIvBuf.subarray(16);
    const cipher = crypto.createDecipheriv("aes-256-gcm", passwordHash, initVector);
    return cipher.update(encBuf).toString("utf-8");
}