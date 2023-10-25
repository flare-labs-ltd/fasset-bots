import { readFileSync, statSync } from "fs";
import { CommandLineError } from "../utils/helpers";

const SECRETS_FILE = "./secrets.json";

export type Secrets = {
    wallet?: {
        encryption_password: string;
    };
    apiKey: {
        [key: string]: string
    };
    owner?: UnifiedAccount;
    user?: UnifiedAccount;
    challenger?: NativeAccount;
    timeKeeper?: NativeAccount;
    systemKeeper?: NativeAccount;
    deployer?: NativeAccount;
  }

export interface NativeAccount {
    native_private_key: string;
    native_address: string;
}

export interface UnderlyingAccount {
    underlying_private_key: string;
    underlying_address: string;
}

export interface UnifiedAccount extends NativeAccount, UnderlyingAccount {}

export function getSecrets(): Secrets {
    if (loadedSecrets == undefined) {
        loadedSecrets = loadSecrets();
    }
    return loadedSecrets;
}

let loadedSecrets: Secrets | undefined;

function loadSecrets(): Secrets {
    checkFilePermissions(SECRETS_FILE);
    const config = JSON.parse(readFileSync(SECRETS_FILE).toString());
    return config;
}

/* istanbul ignore next */
function checkFilePermissions(fpath: string) {
    if (process.platform === 'win32') {
        if (process.env.ALLOW_SECRETS_ON_WINDOWS === 'true') return;
        throw new CommandLineError("Cannot reliably check secrets.json permissions on Windows.\n" +
            "To allow reading secrets file anyway, set environment variable ALLOW_SECRETS_ON_WINDOWS=true.");
    }
    // file must only be accessible by the process user
    const stat = statSync(fpath);
    const processUid = process.getuid!();
    if (!(stat.uid === processUid && (stat.mode & 0o077) === 0)) {
        throw new CommandLineError("File secrets.json must only be readable by the process user. Set permission bits to 600.");
    }
}

export function requireSecret(name: string): string {
    const value = valueForKeyPath(getSecrets(), name);
    if (typeof value === 'string') return value;
    throw new Error(`Secret variable ${name} not defined or not typeof string`);
}

function valueForKeyPath(obj: any, path: string) {
    const keys = path.split('.');
    keys.forEach((key) => {
        return obj = obj?.[key];
    });
    return obj;
}
