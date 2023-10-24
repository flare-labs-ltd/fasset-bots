import { readFileSync } from "fs";

export function defineAppConfig(): AppConfig {
    const appConfigFile = "./app-config.json";
    const config = JSON.parse(readFileSync(appConfigFile).toString());
    return config;
}

export type AppConfig = {
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