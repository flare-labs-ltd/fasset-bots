import { readFileSync } from "fs";

export type Secrets = {
    wallet_encryption_password: string;
    apiKey: { [key: string]: string };
    owner: UnifiedAccount;
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
    const secretsFile = "./secrets.json";
    const config = JSON.parse(readFileSync(secretsFile).toString());
    return config;
}

export function requireSecret(name: string): string {
    const value = valueForKeyPath(getSecrets(), name);
    if (typeof value === 'string') return value;
    throw new Error(`Config variable ${name} not defined or not typeof string`);
}

function valueForKeyPath(obj: any, path: string) {
    const keys = path.split('.');
    keys.forEach((key) => {
        return obj = obj?.[key];
    });
    return obj;
}
