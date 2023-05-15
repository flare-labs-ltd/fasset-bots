# LiquidatorBot

File [`Liquidator.ts`](../../src/actors/Liquidator.ts) contains framework for such an actor in FAsset system.

## Prerequirements
User needs:
- **native address**
- **fAssets**
- [TODO] simplified version of IAssetBotContext
- [TODO] liquidatorBotConfig.ts (simplified version of BotConfig)
- [TODO] script to run it

### Initialization
Initially, the constructor takes in **runner** (ScopedRunner), **address** (native address), **state** (TrackedState) as inputs:
```
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

Secondly, it checks following events:
- **PriceEpochFinalized**:
    - checks if any agent has entered the liquidation status based on their recently calculated collateral ratios
    - liquidates agent
- **MintingExecuted**:
    - checks if agent has entered the liquidation status based on its recently calculated collateral ratios
    - liquidates agent

