# TimeKeeperBot

Time keeper proves that underlying block with given number and timestamp exists and updates the current underlying block info if the provided data is higher. This bot should be used by minters before minting and by agent's regularly to prevent current block being too outdated, which gives too short time for minting or redemption payment.

File [TimeKeeper.ts](../src/actors/TimeKeeper.ts) contains framework for such actor in FAsset system.

## Prerequirements
User needs:
- To create [**running configuration**](../../src/config/BotConfig.ts).
```javascript
export interface TrackedStateRunConfig {
    nativeChainInfo: NativeChainInfo;
    chainInfos: BotChainInfo[];
    rpcUrl: string,
    attestationProviderUrls: string[],
    stateConnectorAddress: string,
    stateConnectorProofVerifierAddress: string,
    ownerAddress: string,
    // either one must be set
    addressUpdater?: string;
    contractsJsonFile?: string;
}
```
- To set environment **.env** in root directory.
For more see [configuration part](../config.md).
```
# XRP
XRP_URL_WALLET=https://s.altnet.rippletest.net:51234
# DB ENCRYPTION
WALLET_ENCRYPTION_PASSWORD=
# NATIVE CHAIN i.e. COSTON2
ATTESTER_BASE_URLS="https://attestation-coston2.aflabs.net/attestation-client/"
RPC_URL=https://coston2-api.flare.network/ext/bc/C/rpc
STATE_CONNECTOR_ADDRESS=0x1000000000000000000000000000000000000001
STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS=0x8858eeB3DfffA017D4BCE9801D340D36Cf895CCf
# INDEXERS
INDEXER_XRP_WEB_SERVER_URL=
INDEXER_XRP_API_KEY=
# RUN CONFIG PATH
RUN_CONFIG_PATH="./run-config/run-simplified-config-coston2-with-contracts.json"
```

### Initialization
The constructor takes in **asset context** (IAssetTrackedStateContext) input:
```javascript
   constructor(
       public context: IAssetTrackedStateContext
   ) { }
```
## TimeKeeperBot Automation
The **run** method is responsible for managing proofs and updates. It set a recurring task of proving and updating underlying blocks every minute.

