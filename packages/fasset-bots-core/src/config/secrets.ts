import { readFileSync, statSync } from "fs";
import { ENCRYPTION_PASSWORD_MIN_LENGTH, requireEnv } from "../utils/helpers";
import { CommandLineError } from "../utils/command-line-errors";
import { SecretsFile } from "./config-files/SecretsFile";

export function getSecrets(): SecretsFile {
    if (loadedSecrets == undefined) {
        loadedSecrets = loadSecrets(defaultSecretsPath());
    }
    return loadedSecrets;
}

export function resetSecrets(secretsPath: string) {
    loadedSecrets = loadSecrets(secretsPath);
}

let loadedSecrets: SecretsFile | undefined;

function loadSecrets(secretsPath: string): SecretsFile {
    checkFilePermissions(secretsPath);
    const secrets = JSON.parse(readFileSync(secretsPath).toString());
    return secrets;
}

function defaultSecretsPath(): string {
    return requireEnv("FASSET_BOT_SECRETS");
}

export function requireEncryptionPassword(name: string, secrets?: SecretsFile): string {
    const value = requireSecret(name, secrets);
    if (value.length < ENCRYPTION_PASSWORD_MIN_LENGTH) {
        throw new Error(`'${name}' should be at least ${ENCRYPTION_PASSWORD_MIN_LENGTH} chars long`);
    }
    return value;
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

export function requireSecret(name: string, secrets?: SecretsFile): string {
    const value = valueForKeyPath(secrets ?? getSecrets(), name);
    if (typeof value === "string") return value;
    throw new Error(`Secret variable ${name} not defined or not typeof string`);
}

function valueForKeyPath(obj: any, path: string) {
    const keys = path.split(".");
    keys.forEach((key) => {
        return (obj = obj?.[key]);
    });
    return obj;
}
