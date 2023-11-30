import { readFileSync, statSync } from "fs";
import { CommandLineError, ENCRYPTION_PASSWORD_MIN_LENGTH } from "../utils/helpers";

const DEFAULT_SECRETS_JSON_PATH = "./secrets.json";

export type Secrets = {
    wallet?: {
        encryption_password: string;
    };
    apiKey: {
        [key: string]: string;
    };
    owner?: UnifiedAccount;
    user?: UnifiedAccount;
    challenger?: NativeAccount;
    liquidator?: NativeAccount;
    timeKeeper?: NativeAccount;
    systemKeeper?: NativeAccount;
    deployer?: NativeAccount;
    database?: DatabaseAccount;
};

export interface NativeAccount {
    native_private_key: string;
    native_address: string;
}

export interface UnderlyingAccount {
    underlying_private_key: string;
    underlying_address: string;
}

export interface DatabaseAccount {
    user: string;
    password: string;
}

export interface UnifiedAccount extends NativeAccount, UnderlyingAccount {}

export function getSecrets(): Secrets {
    if (loadedSecrets == undefined) {
        loadedSecrets = loadSecrets(DEFAULT_SECRETS_JSON_PATH);
    }
    return loadedSecrets;
}

export function resetSecrets(secretsPath: string | null) {
    if (secretsPath != null) {
        loadedSecrets = loadSecrets(secretsPath);
    } else {
        loadedSecrets = { apiKey: {} };
    }
}

let loadedSecrets: Secrets | undefined;

function loadSecrets(secretsPath: string): Secrets {
    checkFilePermissions(secretsPath);
    const secrets = JSON.parse(readFileSync(secretsPath).toString());
    return secrets;
}

export function requireEncryptionPassword(name: string, secrets?: Secrets): string {
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
    const processUid = process.getuid!();
    if (!(stat.uid === processUid && (stat.mode & 0o077) === 0)) {
        throw new CommandLineError(`File ${fpath} must only be readable by the process user. Set permission bits to 600.`);
    }
}

export function requireSecret(name: string, secrets?: Secrets): string {
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
