export interface ChainAccount {
    address: string;
    private_key: string;
}

export interface DatabaseAccount {
    user: string;
    password: string;
}

export type SecretsFile = {
    wallet?: {
        encryption_password: string;
    };
    apiKey: {
        [key: string]: string;
    };
    owner?: {
        [key: string]: ChainAccount;
    };
    user?: {
        [key: string]: ChainAccount;
    };
    requestSubmitter?: ChainAccount;
    challenger?: ChainAccount;
    liquidator?: ChainAccount;
    timeKeeper?: ChainAccount;
    systemKeeper?: ChainAccount;
    deployer?: ChainAccount;
    database?: DatabaseAccount;
}
