# Configuration

## Configuration file
In order to run FAsset bots following configuration must be provided (see interface `RunConfig` in [`BotConfig.ts`](../src/config/BotConfig.ts)). Path to config file should be set in `.env` as `RUN_CONFIG_PATH` variable.

Example:
```json
{
  "loopDelay": 10000,
  "nativeChainInfo": { "finalizationBlocks": 0, "readLogsChunkSize": 10 },
  "chainInfos": [
    {
      "chainId": 3,
      "name": "Ripple",
      "symbol": "XRP",
      "decimals": 6,
      "amgDecimals": 0,
      "requireEOAProof": false,
      "fAssetSymbol": "FtestXRP"
    }
  ],
  "ormOptions": {
    "dbName": "fasset-bots-c2.db",
    "debug": false,
    "allowGlobalContext": true
  },
  "contractsJsonFile": "../fasset/deployment/deploys/coston2.json"
}
```

## Environment file
In order to set environment of FAsset bots following must be provided (see [`env.template`](../.env.template)).

Example:

```env
# XRP
XRP_URL_WALLET=https://s.altnet.rippletest.net:51234
XRP_URL_MCC=https://s.altnet.rippletest.net:51234

# DB ENCRYPTION
WALLET_ENCRYPTION_PASSWORD=123456

# NATIVE CHAIN
ATTESTER_BASE_URLS="https://flare4.oracle-daemon.com/coston2"
RPC_URL=https://coston2-api.flare.network/ext/bc/C/rpc
STATE_CONNECTOR_ADDRESS=0x1000000000000000000000000000000000000001
ATTESTATION_CLIENT_ADDRESS=0x8858eeB3DfffA017D4BCE9801D340D36Cf895CCf

OWNER_ADDRESS=
OWNER_PRIVATE_KEY=

# INDEXER
INDEXER_WEB_SERVER_URL=http://flare.xrp.indexer

# UNDERLYING CHAIN
OWNER_UNDERLYING_ADDRESS="OwnerUnderlyingXRPAddress"
OWNER_UNDERLYING_PRIVATE_KEY="OwnerUnderlyingXRPPrivateKey"

# RUN CONFIG PATH
RUN_CONFIG_PATH="./run-config/run-config-coston2-with-contracts.json"
```

# How to run

First configure configuration and environment files. Than run script [`run-agent.ts`](../src/run-agent.ts).
The script will create [AgentBotRunner](../src/actors/AgentBotRunner.ts). The runner is constantly checking if any active agent stored in persistent state should handle any incoming events (see [Agent](./actors/agent.md)).

Basic operations (create agent vault, deposit to vault, enter/exit available agent's list, ...) can be done via command line interface [`fasset-bots-cli`](./cli.md).