# LiquidatorBot

File [Liquidator.ts](../../src/actors/Liquidator.ts) contains framework for such actor in FAsset system.

## Prerequirements
User needs:
- **native address**
- **fAssets**
- to create [**running configuration**](../../src/config/BotConfig.ts)
```javascript
export interface TrackedStateRunConfig {
    nativeChainInfo: NativeChainInfo;
    chainInfos: BotChainInfo[];
    // either one must be set
    addressUpdater?: string;
    contractsJsonFile?: string;
```
- to set environment **.env** in root directory
```
# XRP
XRP_URL_WALLET=https://s.altnet.rippletest.net:51234
# DB ENCRYPTION
WALLET_ENCRYPTION_PASSWORD=
# NATIVE CHAIN i.e. COSTON2
ATTESTER_BASE_URLS="https://attestation-coston2.aflabs.net/attestation-client/"
RPC_URL=https://coston2-api.flare.network/ext/bc/C/rpc
STATE_CONNECTOR_ADDRESS=0x1000000000000000000000000000000000000001
ATTESTATION_CLIENT_ADDRESS=0x8858eeB3DfffA017D4BCE9801D340D36Cf895CCf
# INDEXERS
INDEXER_XRP_WEB_SERVER_URL=
INDEXER_XRP_API_KEY=
# RUN CONFIG PATH
RUN_CONFIG_PATH="./run-config/run-simplified-config-coston2-with-contracts.json"
```

### Initialization
Initially, the constructor takes in **runner** (ScopedRunner), **address** (native address), **state** (TrackedState) as inputs:
```javascript
   constructor(
       public runner: ScopedRunner,
       public address: string,
       public state: TrackedState
   ) { }
```

## LiquidatorBot Automation
The **runStep** method is responsible for managing all relevant Agent events and comprises:
- **registerEvents**

### registerEvents
Initially, it triggers event handling in **parent** (TrackedState) with method **readUnhandledEvents**.

Secondly, it checks following native events:
- **PriceEpochFinalized**:
    - checks if any agent has entered the liquidation status based on their recently calculated collateral ratios
    - liquidates agent
- **MintingExecuted**:
    - checks if agent has entered the liquidation status based on its recently calculated collateral ratios
    - liquidates agent

