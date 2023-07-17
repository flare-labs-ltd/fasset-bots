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

### Initialization
The constructor takes in **asset context** (IAssetTrackedStateContext) input:
```javascript
   constructor(
       public context: IAssetTrackedStateContext
   ) { }
```
## TimeKeeperBot Automation
The **run** method is responsible for managing proofs and updates. It set a recurring task of proving and updating underlying blocks every minute.

