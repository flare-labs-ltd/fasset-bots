# Configuration

## Configuration file
In order to run FAsset bots following configuration must be provided (see interface `RunConfig` in [BotConfig.ts](../src/config/BotConfig.ts)). Path to config file should be set in `.env` as `RUN_CONFIG_PATH` variable.

Example:
```json
{
    "loopDelay": 10000,
    "contractsJsonFile": "../fasset/deployment/deploys/coston.json",
    "nativeChainInfo": {
      "finalizationBlocks": 0,
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
        "indexerUrl": "https://attestation-coston2.aflabs.net/verifier/xrp/",
        "walletUrl": "https://s.altnet.rippletest.net:51234"
      }
    ],
    "ormOptions": {
      "dbName": "fasset-bots-coston.db",
      "debug": false,
      "allowGlobalContext": true
    },
    "rpcUrl": "https://coston-api.flare.network/ext/C/rpc",
    "attestationProviderUrls": [
      "https://attestation-coston.aflabs.net/attestation-client/api-doc"
    ],
    "stateConnectorAddress": "0x0c13aDA1C7143Cf0a0795FFaB93eEBb6FAD6e4e3",
    "stateConnectorProofVerifierAddress": "0x3551096766115b622bD02EF156b151A9D996Fb6E",
    "ownerAddress": "0x56597Fa74890E002Aa4F36E90beEb4E69c7Bae7D",
    "defaultAgentSettingsPath": "./run-config/agent-settings-config.json"
  }
```

## Environment file
In order to set environment of FAsset bots following must be provided (see [`env.template`](../.env.template)).

Example:

```env
# DB ENCRYPTION
WALLET_ENCRYPTION_PASSWORD=

# NATIVE CHAIN
OWNER_PRIVATE_KEY=

# INDEXER
INDEXER_API_KEY=

# UNDERLYING CHAIN
OWNER_UNDERLYING_ADDRESS=
OWNER_UNDERLYING_PRIVATE_KEY=

# RUN CONFIG PATH
RUN_CONFIG_PATH=

# FLARE_API_PORTAL_KEY
FLARE_API_PORTAL_KEY=
```

# How to run

First configure configuration and environment files. Than run script [`run-agent.ts`](../src/run/run-agent.ts).
The script will create [AgentBotRunner](../src/actors/AgentBotRunner.ts). The runner is constantly checking if any active agent stored in persistent state should handle any incoming events (see [Agent](./actors/agent.md)).

Basic operations (create agent vault, deposit to vault, enter/exit available agent's list, ...) can be done via command line interface [`fasset-bots-cli`](./cli.md).