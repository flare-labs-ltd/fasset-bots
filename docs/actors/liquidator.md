# LiquidatorBot

File [Liquidator.ts](../../src/actors/Liquidator.ts) contains framework for such actor in FAsset system.

## Prerequirements
User needs:
- **native address**.
- **fAssets**
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

