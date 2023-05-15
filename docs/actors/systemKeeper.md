# SystemKeeperBot

System keeper works is in a way similar as Liquidator. It tracks the same events on native chain. After each event it checks Agent's position and either starts or ends liquidation process.

File [SystemKeeper.ts](../src/actors/SystemKeeper.ts) contains framework for such an actor in FAsset system.

## Prerequirements
User needs:
- **native address**
- [TODO] simplified version of IAssetBotContext
- [TODO] systemKeeperBotConfig.ts (simplified version of BotConfig)
- [TODO] script to run it

### Initialization
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

Secondly, it checks following events:
- **PriceEpochFinalized**:
    - verifies whether liquidation for any agent should be initiated or terminated based on their recently calculated collateral ratios
- **MintingExecuted**:
    - verifies whether liquidation for agent should be initiated or terminated based on its recently calculated collateral ratios

