# Configuration

Examples of configuration files can be found [here](../run-config/).

## Agent bot

### Agent bot configuration file

In order to run Agent bot following configuration must be provided (see interface `BotConfigFile` in [config-files.ts](../src/config/config-files.ts)). Path to config file should be set in `.env` as `RUN_CONFIG_PATH` variable.

Example:

```json
{
    "$schema": "./schema/bot-config.schema.json",
    "loopDelay": 5000,
    "contractsJsonFile": "./fasset-deployment/coston.json",
    "nativeChainInfo": {
        "finalizationBlocks": 6,
        "readLogsChunkSize": 10
    },
    "fAssetInfos": [
        {
            "chainId": "XRP",
            "name": "Test XRP",
            "symbol": "testXRP",
            "decimals": 6,
            "amgDecimals": 0,
            "finalizationBlocks": 3,
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

### Agent bot environment file

In order to set environment for Agent bot following must be provided (see [`.env.template`](../.env.template)).

Example:

```env
## Path to config file for the agent bot
RUN_CONFIG_PATH="./run-config/run-config-agent-coston-testxrp.json"

## (Optional) Path to config file for users, instead you can use `-c` parameter
# USER_CONFIG_PATH="./run-config/run-config-coston-testxrp.json"

## Enable the following line on Windows to allow reading secrets, since secrets file permission check does not work
# ALLOW_SECRETS_ON_WINDOWS=true
```

### Agent bot secrets file

In order to run Agent bot API keys, addresses, private keys and any other neccessary credentials, should be store in a `secrets.json` file, which follows format (see [`secrets.template.json`](../secrets.template.json)):

```
type Secrets = {
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
```

`secrets.json` needs to have restricted read and write rights. This can be set by `chmod 600 secrets.json`

## Other bots (challenger, liquidator, system keeper, time keeper)

### Other bots configuration file

In order to run other actor bots same instance of configuration must be provided, but not all atributes are required for those bots (check interface `BotConfigFile` in [config-files.ts](../src/config/config-files.ts)) and [examples](../run-config/).

Environment and needed secrets should also be set. See above sections [_Agent bot environment file_](#agent-bot-environment-file) and [_Agent bot secrets file_](#agent-bot-secrets-file).


