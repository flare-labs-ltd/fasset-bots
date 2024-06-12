# SystemKeeperBot

System Keeper works similarly to Liquidator. It tracks the same events on the native chain. After each event, it checks the Agent's position and starts or ends the liquidation process.

The file [SystemKeeper.ts](../../packages/fasset-bots-core/src/actors/SystemKeeper.ts) contains a framework for such an actor in the FAsset system.

## Initialization

Initially, the constructor takes in **runner** (ScopedRunner), **address** (native address), **state** (TrackedState) as inputs:

```javascript
   constructor(
       public runner: ScopedRunner,
       public address: string,
       public state: TrackedState
   ) { }
```

## SystemKeeperBot Automation

The **runStep** method is responsible for managing all relevant Agent events and comprises:

- **registerEvents**

### registerEvents

Initially, it triggers event handling in **parent** (TrackedState) with method **readUnhandledEvents**.

Secondly, it checks the following events:

- **PriceEpochFinalized**:
  - verifies whether liquidation for any agent should be initiated or terminated based on their recently calculated collateral ratios
- **MintingExecuted**:
  - verifies whether liquidation for Agent should be initiated or terminated based on its recently calculated collateral ratios
