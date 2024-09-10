export interface ChainAccount {
    address: string;
    private_key: string;
}

export interface DatabaseAccount {
    user: string;
    password: string;
}

export interface PricePublisher extends ChainAccount {
    price_feed_api_path: string;
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
    challenger?: ChainAccount;
    liquidator?: ChainAccount;
    timeKeeper?: ChainAccount;
    systemKeeper?: ChainAccount;
    deployer?: ChainAccount;
    database?: DatabaseAccount;
    pricePublisher?: PricePublisher;
}
