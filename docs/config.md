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
            "chainId": 3,
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
    "stateConnectorAddress": "0x0c13aDA1C7143Cf0a0795FFaB93eEBb6FAD6e4e3",
    "stateConnectorProofVerifierAddress": "0x3551096766115b622bD02EF156b151A9D996Fb6E",
    "defaultAgentSettingsPath": "./run-config/agent-settings-config.json"
}
```

### Agent bot environment file

In order to set environment for Agent bot following must be provided (see [`env.template`](../.env.template)).

Example:

```env
# DB ENCRYPTION
WALLET_ENCRYPTION_PASSWORD=
# RUN CONFIG PATH
RUN_CONFIG_PATH="./run-config/run-config-agent-coston-testxrp.json"
# API KEYS
NATIVE_RPC_API_KEY=
INDEXER_API_KEY=
# UNDERLYING CHAIN
# Agent bot owner
OWNER_UNDERLYING_ADDRESS=
OWNER_UNDERLYING_PRIVATE_KEY=
# Minters and redeemers
USER_UNDERLYING_ADDRESS=
USER_UNDERLYING_PRIVATE_KEY=
# NATIVE CHAIN
# Agent owner
OWNER_ADDRESS=
OWNER_PRIVATE_KEY=
# Minters and redeemers
USER_ADDRESS=
USER_PRIVATE_KEY=
# Challenger
NATIVE_ACCOUNT1=
NATIVE_ACCOUNT1_PRIVATE_KEY=
# Liquidator
NATIVE_ACCOUNT2=
NATIVE_ACCOUNT2_PRIVATE_KEY=
# Time keeper
NATIVE_ACCOUNT3=
NATIVE_ACCOUNT3_PRIVATE_KEY=
# System keeper
NATIVE_ACCOUNT4=
NATIVE_ACCOUNT4_PRIVATE_KEY=

# AGENT BOT API KEYS - needed only to run agent commands via apis
# expected to be on different servers in 'real-life usage'
AGENT_BOT_API_KEY=
AGENT_BOT_API_KEY_HASH=
```

## Other bots (challenger, liquidator, system keeper, time keeper)

### Other bots configuration file

In order to run other actor bots same instance of configuration must be provided, but not all atributes are required for those bots (check interface `BotConfigFile` in [config-files.ts](../src/config/config-files.ts)) and [examples](../run-config/).
