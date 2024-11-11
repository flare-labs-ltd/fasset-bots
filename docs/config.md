# Configuration

## Agent default settings

```typescript
export interface AgentSettingsConfig {
    /**
     * Token suffix for the new collateral pool's token.
     * Must be unique within this fasset type.
     */
    poolTokenSuffix: string;

    /**
     * The tokenFtsoSymbol symbol in the collateral type for the created agent vault vault vollateral.
     */
    vaultCollateralFtsoSymbol: string;

    /**
     * The minting fee percentage.
     * @pattern ^\d+(\.\d+)?\%?$
     */
    fee: string;

    /**
     * The percentage of the minting fee that goes to the collateral pool.
     * @pattern ^\d+(\.\d+)?\%?$
     */
    poolFeeShare: string;

    /**
     * Agent's minting collateral ratio for vault collateral (minimum CR at which the minting can happen).
     * @pattern ^\d+(\.\d+)?\%?$
     */
    mintingVaultCollateralRatio: string;

    /**
     * Agent's minting collateral ratio for pool collateral (minimum CR at which the minting can happen).
     * @pattern ^\d+(\.\d+)?\%?$
     */
    mintingPoolCollateralRatio: string;

    /**
     * Collateral pool's exit collateral ratio (minimum CR for pool collateral at which the collateral pool providers can exit;
     * however, self-close exit is allowed even at lower pool CR).
     * @pattern ^\d+(\.\d+)?\%?$
     */
    poolExitCollateralRatio: string;

    /**
     * FTSO price factor at which the agent pays for burned fassets (in vault tokens) during pool providers' self close exit.
     * @pattern ^\d+(\.\d+)?\%?$
     */
    buyFAssetByAgentFactor: string;

    /**
     * Pool collateral ratio below which the providers can enter at discounted rate.
     * @pattern ^\d+(\.\d+)?\%?$
     */
    poolTopupCollateralRatio: string;

    /**
     * Discounted price factor at which providers can enter when topup is active (i.e. the pool CR is below poolTopupCollateralRatio).
     * @pattern ^\d+(\.\d+)?\%?$
     */
    poolTopupTokenPriceFactor: string;
}
```

Example:

```json
{
    "$schema": "./schema/agent-settings.schema.json",
    "vaultCollateralFtsoSymbol": "testUSDC",
    "feeBIPS": 1000,
    "poolFeeShareBIPS": 4000,
    "mintingVaultCollateralRatioConstant": 1.2,
    "mintingPoolCollateralRatioConstant": 1.2,
    "poolExitCollateralRatioConstant": 1.3,
    "buyFAssetByAgentFactorBIPS": 9000,
    "poolTopupCollateralRatioConstant": 1.1,
    "poolTopupTokenPriceFactorBIPS": 8000,
    "handshakeType": 0
}
```

## Run config

```typescript
interface BotConfigFile {
    ormOptions?: OrmConfigOptions; // ORM configuration options. Required only for agent bot and user.
    fAssetInfos: BotFAssetInfo[]; // Basic information about fassets.
    walletOptions?: StuckTransaction; // Optional overwrite of default values in simple-wallet in case transaction gets stuck in mempool. For agent bot.
    loopDelay: number; // Delay in ms before running next agent bot's or other actor's step
    nativeChainInfo: NativeChainInfo; // Basic information about native chain.
    rpcUrl: string; // Native chain's url.
    alertsUrl?: string; // Url to send notifications to.
    attestationProviderUrls?: string[]; // List of urls of attestation providers. Only for agent bot, user, challenger and timeKeeper.
    // either one must be set
    addressUpdater?: string; // Address of AddressUpdater contract on native chain.
    contractsJsonFile?: string; // File path to json file containing contract addresses on native chain
    liquidationStrategy?: {
        // Custom liquidation strategy for liquidator. If unset default strategy is used.
        className: string;
        config?: any;
    };
    challengeStrategy?: {
        // Custom liquidation strategy for challenger. If unset default strategy is used.
        className: string;
        config?: any;
    };
}

interface OrmConfigOptions {
    type: DatabaseType;
    schemaUpdate?: SchemaUpdate;
    debug?: boolean;
    // connection building - either clientUrl or some combination of others
    clientUrl?: string;
    dbName?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    charset?: string;
    // allow other options
    [key: string]: any;
}

interface BotFAssetInfo {
    chainId: string;
    name: string;
    symbol: string; // Underlying chain's ftso symbol.
    walletUrl?: string; // Underlying chain's url. Only for agent bot and user.
    indexerUrl?: string; // Underlying chain's indexer url. Only for agent bot, user, challenger and timeKeeper
    // either one must be set.
    assetManager?: string; // AssetManager contract address on native chain.
    fAssetSymbol?: string; // Symbol for the fasset.
    priceChangeEmitter?: string; // The name of the contract (in Contracts file) that emits 'PriceEpochFinalized' event; default is 'FtsoManager'.
}

interface NativeChainInfo {
    finalizationBlocks: number; // Estimated number of blocks to reach finalization.
    readLogsChunkSize: number; // Max number of blocks to read past logs from
}

interface StuckTransaction {
    blockOffset?: number; // How many block to wait for transaction to be validated
    retries?: number; // How many times should transaction retry to successfully submit
    feeIncrease?: number; // Factor to increase fee in resubmitting process
}
```

### Bot run config for `testXRP` and `Coston`
Can be found [here](../packages/fasset-bots-core/run-config/coston-bot.json).
```json
{
    "loopDelay": 5000,
    "contractsJsonFile": "../fasset-deployment/coston.json",
    "prioritizeAddressUpdater": false,
    "nativeChainInfo": {
        "chainName": "Coston",
        "tokenSymbol": "CFLR",
        "finalizationBlocks": 6,
        "readLogsChunkSize": 10
    },
    "fAssets": {
        "FTestXRP": {
            "chainId": "testXRP",
            "tokenName": "Test XRP",
            "tokenSymbol": "testXRP",
            "tokenDecimals": 6,
            "indexerUrl": "https://testnet-verifier-fdc-test.aflabs.org/verifier/xrp",
            "walletUrl": "https://s.altnet.rippletest.net:51234"
        }
    },
    "ormOptions": {
        "dbName": "fasset-bots-coston.db",
        "debug": false,
        "allowGlobalContext": true,
        "type": "sqlite"
    },
    "rpcUrl": "https://coston-api.flare.network/ext/C/rpc",
    "attestationProviderUrls": ["https://attestation-coston.aflabs.net/attestation-client"],
    "liquidationStrategy": {
        "className": "DexLiquidationStrategy",
        "config": {
            "address": "0x250D1792DA9aBACEd6b16a47d6aedf4d2cbbaFeb"
        }
    },
    "challengeStrategy": {
        "className": "DexChallengeStrategy",
        "config": {
            "address": "0xbDcCb53d655f541902De8cf04e68B6E7cE2D9Fa0"
        }
    }
}
```

### Enable responding to agent pings

The status of an agent can be tracked by outside sources using the AgentPing smart contract. This way dApps can check if an agent is online or offline. But by default the agent will not respond to pings from untrusted senders. To add an address to which your agent will respond to you need to add it in the `trustedPingSenders` parameter that is under `agentBotSettings` in `fasset-bots/packages/fasset-bots-core/run-config/coston-bot.json`. For example if we want out agent to respond to addresses `0x0048508b510502555ED47E98dE98Dd6426dDd0C4` and `0xb03fF2AF427FEFb73bcf3263338F42271E30cfD1` we would add these addresses to the `trustedPingSenders` array and the configuration would look like this:
```json
    "trustedPingSenders": ["0x0048508b510502555ED47E98dE98Dd6426dDd0C4","0xb03fF2AF427FEFb73bcf3263338F42271E30cfD1"],
```
The specific addresses to add to this configuration will be communicated to you from the Flare team by Telegram.

## .env

See [`.env.template`](../.env.template).

Example:

```env
## Path to config file for the agent bot (and other bots) for MYSQL
FASSET_BOT_CONFIG="./packages/fasset-bots-core/run-config/coston-bot-mysql.json"
## If you want to use sqlite (not recommended) uncomment the line below and comment the line above
#FASSET_BOT_CONFIG="./packages/fasset-bots-core/run-config/coston-bot.json"

## Path to secrets file for the agent bot (and other bots)
FASSET_BOT_SECRETS="./secrets.json"

## Enable the following line on Windows to allow reading secrets, since secrets file permission check does not work
# ALLOW_SECRETS_ON_WINDOWS=true

## (Optional) Path to config file for users, instead you can use `-c` parameter
# FASSET_USER_CONFIG="./packages/fasset-bots-core/run-config/coston-user.json"

## (Optional) Path to secrets json file for users, instead you can use `-s` parameter.
FASSET_USER_SECRETS="./secrets.json"

## (Optional) Path to directory, used for storing unexecuted minting. Defaults to `fasset` subdirectory in user's home directory.
# FASSET_USER_DATA_DIR=""

## (Optional) Path to database file for the bot (if sqlite is enabled).
#FASSET_BOT_SQLITE_DB ="./fasset-bots-coston.db"
```

## Secrets file

In order to run Agent bot API keys, addresses, private keys and any other necessary credentials, should be store in a `secrets.json` file, which follows format (see [`secrets.template.json`](../secrets.template.json)).

`secrets.json` file needs to have restricted read and write rights. This can be set by
`chmod 600 secrets.json`.

```typescript
type Secrets = {
    wallet?: {
        encryption_password: string; // Password to be used in encryption and decryption of addresses and private keys in local database. Only for agent bot and user.
    };
    apiKey: {
        [key: string]: string; // Various API key needed to access certain services.
    };
    owner?: {
        [key: string]: ChainAccount; // Agent owner's native and underlying addresses and private keys.
    };
    user?: {
        [key: string]: ChainAccount; // User's native and underlying addresses and private keys.
    };
    challenger?: ChainAccount; // Challenger's native addresses and private keys.
    liquidator?: ChainAccount; // Liquidator's native addresses and private keys.
    timeKeeper?: ChainAccount; // Time keeper's native addresses and private keys.
    systemKeeper?: ChainAccount; // System keeper's native addresses and private keys.
    deployer?: ChainAccount; // Deployer's native addresses and private keys.
    database?: DatabaseAccount; // Credentials required for database access.
};

interface ChainAccount {
    address: string;
    private_key: string;
}

interface DatabaseAccount {
    user: string;
    password: string;
}
```

### Agent bot secrets file

```json
{
    "wallet": {
        "encryption_password": "SuperSecurePasswordThatIsVeryLong"
    },
    "apiKey": {
        "indexer": "",
        "native_rpc": ""
    },
    "owner": {
        "management": {
            "address": ""
        },
        "native": {
            "address": "",
            "private_key": ""
        },
        "testXRP": {
            "address": "",
            "private_key": ""
        }
    },
    "timeKeeper": {
        "address": "",
        "private_key": ""
    }
}
```

Underlying addresses `owner.[chainId].address` and private keys and `owner.[chainId].private_key` can be generated via command

`yarn agent-bot createUnderlyingAccount -f <fassetSymbol>`

Example:
`yarn agent-bot createUnderlyingAccount -f FTestXRP`

Variable `wallet.encryption_password` should be at least 16 characters long. It can be generated via command

`yarn key-gen createWalletEncryptionPassword`

### Challenger bot secrets file

```json
{
    "apiKey": {
        "indexer": "",
        "native_rpc": ""
    },
    "challenger": {
        "address": "",
        "private_key": ""
    }
}
```

### Liquidator bot secrets file

```json
{
    "apiKey": {
        "indexer": "",
        "native_rpc": ""
    },
    "liquidator": {
        "address": "",
        "private_key": ""
    }
}
```

### System keeper bot secrets file

```json
{
    "apiKey": {
        "indexer": "",
        "native_rpc": ""
    },
    "systemKeeper": {
        "address": "",
        "private_key": ""
    }
}
```

### Time keeper bot secrets file

```json
{
    "apiKey": {
        "indexer": "",
        "native_rpc": ""
    },
    "timeKeeper": {
        "address": "",
        "private_key": ""
    }
}
```

## Other bots (challenger, liquidator, system keeper, time keeper)

### Other bots configuration file

In order to run other actor bots same instance of configuration must be provided, but not all atributes are required for those bots (check interface `BotConfigFile` in [config-files.ts](../src/config/config-files.ts)) and [examples](../run-config/).

Environment and needed secrets should also be set. See above sections [_Agent bot environment file_](#agent-bot-environment-file) and [_Agent bot secrets file_](#agent-bot-secrets-file).
