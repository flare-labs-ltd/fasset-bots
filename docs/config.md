# Configuration

## Agent default settings

```typescript
interface AgentSettingsConfig {
    vaultCollateralFtsoSymbol: string; // FTSO symbol for chosen vault collateral.
    feeBIPS: string | number; // Agent's minting fee in BIPS.
    poolFeeShareBIPS: string | number; // Share of the minting fee that goes to the pool as percentage of the minting fee.
    mintingVaultCollateralRatioConstant: number; // Constant multiplier is used to determine the mintingPoolCollateralRatioBIPS by applying it to the minimal pool collateral ratio in BIPS.
    mintingPoolCollateralRatioConstant: number; // Constant multiplier is used to determine the mintingPoolCollateralRatioBIPS by applying it to the minimal pool collateral ratio in BIPS.
    poolExitCollateralRatioConstant: number; // Constant multiplier is used to determine the poolExitCollateralRatioBIPS by applying it to the minimal pool collateral ratio in BIPS.
    buyFAssetByAgentFactorBIPS: string | number; // The factor to multiply the price at which agent buys f-assets from pool.
    poolTopupCollateralRatioConstant: number; // Constant multiplier is used to determine the poolTopupCollateralRatioBIPS by applying it to the minimal pool collateral ratio in BIPS.
    poolTopupTokenPriceFactorBIPS: string | number; // The discount to pool token price when entering and pool collateral ratio is below pool topup collateral ratio.
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
    "poolTopupTokenPriceFactorBIPS": 8000
}
```

## Run config

```typescript
interface BotConfigFile {
    defaultAgentSettingsPath?: string; // Path to agent settings file. Required only for agent bot.
    ormOptions?: OrmConfigOptions; // ORM configuration options. Required only for agent bot and user.
    fAssetInfos: BotFAssetInfo[]; // Basic information about fassets.
    walletOptions?: StuckTransaction; // Optional overwrite of default values in simple-wallet in case transaction gets stuck in mempool. For agent bot.
    loopDelay: number; // Delay in ms before running next agent bot's or other actor's step
    nativeChainInfo: NativeChainInfo; // Basic information about native chain.
    rpcUrl: string; // Native chain's url.
    attestationProviderUrls?: string[]; // List of urls of attestation providers. Only for agent bot, user, challenger and timeKeeper.
    stateConnectorAddress?: string; // Address of StateConnector contract on native chain. Only for agent bot, user, challenger and timeKeeper.
    stateConnectorProofVerifierAddress?: string; // Address of SCProofVerifier contract on native chain. Only for agent bot, user, challenger and timeKeeper.
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

interface BotFAssetInfo extends ChainInfo {
    walletUrl?: string; // Underlying chain's url. Only for agent bot and user.
    indexerUrl?: string; // Underlying chain's indexer url. Only for agent bot, user, challenger and timeKeeper
    // either one must be set.
    assetManager?: string; // AssetManager contract address on native chain.
    fAssetSymbol?: string; // Symbol for the fasset.
    priceChangeEmitter?: string; // The name of the contract (in Contracts file) that emits 'PriceEpochFinalized' event; default is 'FtsoManager'.
}

interface ChainInfo {
    // Underlying chain info.
    chainId: string;
    name: string;
    symbol: string; // Underlying chain's ftso symbol.
    decimals: number;
    amgDecimals: number;
    requireEOAProof: boolean;
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

### Agent bot run config for `testXRP` and `Coston`
Can be found [here](../run-config/run-config-agent-coston-testxrp.json).
```json
{
    "loopDelay": 5000,
    "contractsJsonFile": "./fasset-deployment/coston.json",
    "nativeChainInfo": {
        "finalizationBlocks": 6,
        "readLogsChunkSize": 10
    },
    "fAssetInfos": [
        {
            "chainId": "testXRP",
            "name": "Test XRP",
            "symbol": "testXRP",
            "decimals": 6,
            "amgDecimals": 0,
            "requireEOAProof": false,
            "fAssetSymbol": "FtestXRP",
            "indexerUrl": "https://attestation-coston.aflabs.net/verifier/xrp",
            "walletUrl": "https://s.altnet.rippletest.net:51234"
        }
    ],
    "ormOptions": {
        "dbName": "fasset-bots-coston.db",
        "debug": false,
        "allowGlobalContext": true,
        "type": "sqlite"
    },
    "rpcUrl": "https://coston-api.flare.network/ext/C/rpc",
    "attestationProviderUrls": ["https://attestation-coston.aflabs.net/attestation-client"],
    "defaultAgentSettingsPath": "./run-config/agent-settings-config.json"
}
```

### Challenger run config for `testXRP` and `Coston`
Can be found [here](../run-config/run-config-challenger-coston-testxrp.json).
```json
{
    "loopDelay": 5000,
    "contractsJsonFile": "./fasset-deployment/coston.json",
    "nativeChainInfo": {
        "finalizationBlocks": 6,
        "readLogsChunkSize": 10
    },
    "fAssetInfos": [
        {
            "chainId": "testXRP",
            "name": "Test XRP",
            "symbol": "testXRP",
            "decimals": 6,
            "amgDecimals": 0,
            "requireEOAProof": false,
            "fAssetSymbol": "FtestXRP",
            "indexerUrl": "https://attestation-coston.aflabs.net/verifier/xrp"
        }
    ],
    "rpcUrl": "https://coston-api.flare.network/ext/C/rpc",
    "attestationProviderUrls": ["https://attestation-coston.aflabs.net/attestation-client"]
}
```
### Liquidator run config  for `fakeXRP` and `Coston`

```json
{
    "loopDelay": 5000,
    "contractsJsonFile": "./fasset-deployment/coston.json",
    "nativeChainInfo": {
        "finalizationBlocks": 6,
        "readLogsChunkSize": 10
    },
    "fAssetInfos": [
        {
            "chainId": "testXRP",
            "name": "Fake XRP",
            "symbol": "fakeXRP",
            "decimals": 6,
            "amgDecimals": 0,
            "requireEOAProof": false,
            "fAssetSymbol": "FfakeXRP",
            "indexerUrl": "https://attestation-coston.aflabs.net/verifier/xrp",
            "walletUrl": "https://s.altnet.rippletest.net:51234",
            "priceChangeEmitter": "FakePriceReader"
        }
    ],
    "rpcUrl": "https://coston-api.flare.network/ext/C/rpc"
}
```

### Liquidator and system keeper run config  for `testXRP` and `Coston`
Can be found [here](../run-config/run-config-liquidator-coston-testxrp.json).
```json
{
    "loopDelay": 5000,
    "contractsJsonFile": "./fasset-deployment/coston.json",
    "nativeChainInfo": {
        "finalizationBlocks": 6,
        "readLogsChunkSize": 10
    },
    "fAssetInfos": [
        {
            "chainId": "testXRP",
            "name": "Test XRP",
            "symbol": "testXRP",
            "decimals": 6,
            "amgDecimals": 0,
            "requireEOAProof": false,
            "fAssetSymbol": "FtestXRP"
        }
    ],
    "rpcUrl": "https://coston-api.flare.network/ext/C/rpc"
}
```

### Time keeper run config for `testXRP` and `Coston`
Can be found [here](../run-config/run-config-timeKeeper-coston-testxrp.json).
```json
{
    "loopDelay": 5000,
    "contractsJsonFile": "./fasset-deployment/coston.json",
    "nativeChainInfo": {
        "finalizationBlocks": 6,
        "readLogsChunkSize": 10
    },
    "fAssetInfos": [
        {
            "chainId": "testXRP",
            "name": "Test XRP",
            "symbol": "testXRP",
            "decimals": 6,
            "amgDecimals": 0,
            "requireEOAProof": false,
            "fAssetSymbol": "FtestXRP",
            "indexerUrl": "https://attestation-coston.aflabs.net/verifier/xrp"
        }
    ],
    "rpcUrl": "https://coston-api.flare.network/ext/C/rpc",
    "attestationProviderUrls": ["https://attestation-coston.aflabs.net/attestation-client"]
}
```

## .env

See [`.env.template`](../.env.template).

Example:

```env
## Path to config file for the agent bot
RUN_CONFIG_PATH="./run-config/run-config-agent-coston-testxrp.json"

## Enable the following line on Windows to allow reading secrets, since secrets file permission check does not work
# ALLOW_SECRETS_ON_WINDOWS=true

## (Optional) Path to config file for users, instead you can use `-c` parameter
# FASSET_USER_CONFIG="./run-config/run-config-agent-coston-testxrp.json"

## (Optional) Path to secrets json file for users, instead you can use `-s` parameter.
# FASSET_USER_SECRETS=""

## (Optional) Path to directory, used for storing unexecuted minting. Defaults to `fasset-bots` home directory.
# FASSET_USER_DATA_DIR=""
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
`yarn agent-bot createUnderlyingAccount -f FtestXRP`

Variable `wallet.encryption_password` should be at least 16 characters long. It can be generated via command

`yarn key createWalletEncryptionPassword`

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
