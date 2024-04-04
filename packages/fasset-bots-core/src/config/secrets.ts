import { readFileSync, statSync } from "fs";
import { CommandLineError } from "../utils/command-line-errors";
import { SecretsFile } from "./config-files/SecretsFile";

export const ENCRYPTION_PASSWORD_MIN_LENGTH = 16;

export class Secrets {
    constructor(
        public data: SecretsFile,
    ) {}

    static load(secretsPath: string) {
        const data = loadSecrets(secretsPath);
        return new Secrets(data);
    }

    required(key: string): string {
        const value = valueForKeyPath(this.data, key);
        if (typeof value === "string") return value;
        throw new Error(`Secret variable ${key} not defined or not typeof string`);
    }

    optional(key: string): string | undefined {
        const value = valueForKeyPath(this.data, key);
        if (value == undefined) return undefined;
        if (typeof value === "string") return value;
        throw new Error(`Secret variable ${key} not typeof string`);
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

function validateEncryptionPassword(value: string, key: string) {
    if (value.length < ENCRYPTION_PASSWORD_MIN_LENGTH) {
        throw new Error(`'${key}' should be at least ${ENCRYPTION_PASSWORD_MIN_LENGTH} chars long`);
    }
}

/* istanbul ignore next */
function checkFilePermissions(fpath: string) {
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
