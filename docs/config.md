# Configuration

## Agent bot

### Agent bot configuration file

In order to run Agent bot following configuration must be provided (see interface `RunConfig` in [BotConfig.ts](../src/config/BotConfig.ts)). Path to config file should be set in `.env` as `RUN_CONFIG_PATH` variable.

Example:

```json
{
    "loopDelay": 10000,
    "contractsJsonFile": "../fasset/deployment/deploys/coston.json",
    "nativeChainInfo": {
        "finalizationBlocks": 6,
        "readLogsChunkSize": 10
    },
    "chainInfos": [
        {
            "chainId": 3,
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

# NATIVE CHAIN
OWNER_ADDRESS=
OWNER_PRIVATE_KEY=

# UNDERLYING CHAIN
OWNER_UNDERLYING_ADDRESS=
OWNER_UNDERLYING_PRIVATE_KEY=

# RUN CONFIG PATH
RUN_CONFIG_PATH=

# FLARE_API_PORTAL_KEY
FLARE_API_PORTAL_KEY=

# INDEXER
INDEXER_API_KEY=
```

## Other bots (challenger, liquidator and system keeper)

### Other bots configuration file

In order to run bots that rely on [TrackedState](../src/state/TrackedState.ts), following configuration must be provided (see interface `RunConfig` in [BotConfig.ts](../src/config/BotConfig.ts)).

Example:

```json
{
    "loopDelay": 5000,
    "contractsJsonFile": "../fasset/deployment/deploys/coston.json",
    "nativeChainInfo": { "finalizationBlocks": 6, "readLogsChunkSize": 10 },
    "chainInfos": [
        {
            "chainId": 3,
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
    "attestationProviderUrls": ["https://attestation-coston.aflabs.net/attestation-client"],
    "stateConnectorAddress": "0x0c13aDA1C7143Cf0a0795FFaB93eEBb6FAD6e4e3",
    "stateConnectorProofVerifierAddress": "0x3551096766115b622bD02EF156b151A9D996Fb6E"
}
```
