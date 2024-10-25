import { readFileSync, statSync } from "fs";
import { CommandLineError } from "../utils/command-line-errors";
import { SecretsFile } from "./config-files/SecretsFile";
import { isJSON, promptForPassword } from "../utils/prompt";
import { decryptText } from "../utils/encryption";

export const ENCRYPTION_PASSWORD_MIN_LENGTH = 16;

export class Secrets {
    constructor(
        public filePath: string,
        public data: SecretsFile,
    ) {}

    static async load(secretsPath: string): Promise<Secrets> {
        const newSecretsContent = readFileSync(secretsPath).toString();
        if (!isJSON(newSecretsContent)) {
            const secretsPassword = await promptForPassword("Please enter the password used to decrypt secrets file content: ");
            const data = loadEncryptedSecrets(secretsPath, secretsPassword)
            return new Secrets(secretsPath, data);
        } else {
            const data = loadSecrets(secretsPath);
            return new Secrets(secretsPath, data);
        }
    }

    required(key: string): string {
        const value = valueForKeyPath(this.data, key);
        if (typeof value === "string") return value;
        throw new Error(`Secret variable ${key} not defined or not typeof string`);
    }

    requiredArray(key: string): string[] {
        const value = valueForKeyPath(this.data, key);
        if (Array.isArray(value) && value.every(v => typeof v === "string")) {
            return value;
        }
        throw new Error(`Secret variable ${key} not defined or not typeof string[]`);
    }

    optional(key: string): string | undefined {
        const value = valueForKeyPath(this.data, key);
        if (value == undefined) return undefined;
        if (typeof value === "string") return value;
        throw new Error(`Secret variable ${key} not typeof string`);
    }

    optionalArray(key: string): string[] | undefined {
        const value = valueForKeyPath(this.data, key);
        if (value == undefined) return undefined;
        if (Array.isArray(value) && value.every(v => typeof v === "string")) {
            return value;
        }
        throw new Error(`Secret variable ${key} not typeof string[]`);
    }

    requiredEncryptionPassword(key: string): string {
        const value = this.required(key);
        validateEncryptionPassword(value, key);
        return value;
    }
}

function loadSecrets(secretsPath: string): SecretsFile {
    checkFilePermissions(secretsPath);
    const secrets = JSON.parse(readFileSync(secretsPath).toString());
    return secrets;
}

function loadEncryptedSecrets(secretsPath: string, secretsPassword: string): SecretsFile {
    checkFilePermissions(secretsPath);
    const secretsContent = readFileSync(secretsPath).toString();
    const decryptedContent = decryptText(secretsPassword, secretsContent);
    const secrets = JSON.parse(decryptedContent);
    return secrets;
}

export function validateEncryptionPassword(value: string, key: string): void {
    if (value.length < ENCRYPTION_PASSWORD_MIN_LENGTH) {
        throw new Error(`'${key}' should be at least ${ENCRYPTION_PASSWORD_MIN_LENGTH} chars long`);
    }
}

/* istanbul ignore next */
function checkFilePermissions(fpath: string): void {
    if (process.platform === "win32") {
        if (process.env.ALLOW_SECRETS_ON_WINDOWS === "true") return;
        throw new CommandLineError(
            "Cannot reliably check secrets file permissions on Windows.\n" +
            "To allow reading secrets file anyway, set environment variable ALLOW_SECRETS_ON_WINDOWS=true."
        );
    }
    // file must only be accessible by the process user
    const stat = statSync(fpath);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const processUid = process.getuid!();
    if (!(stat.uid === processUid && (stat.mode & 0o077) === 0)) {
        throw new CommandLineError(`File ${fpath} must only be readable by the process user. Set permission bits to 600.`);
    }
}

function valueForKeyPath(object: any, path: string) {
    const keys = path.split(".");
    keys.forEach((key) => {
        return (object = object?.[key]);
    });
    return object;
}
