# LiquidatorBot

File [Liquidator.ts](../../packages/fasset-bots-core/src/actors/Liquidator.ts) contains a framework for such actor in the FAsset system.

## Initialization

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

Secondly, it checks the following native events:

- **PriceEpochFinalized**:
  - checks if any agent has entered the liquidation status based on their recently calculated collateral ratios
  - liquidates agent
- **MintingExecuted**:
  - checks if the agent has entered the liquidation status based on its recently calculated collateral ratios
  - liquidates agent

## Liquidator strategies

We offer two strategies for liquidation of an FAsset agent. In both instances, the liquidator bot operators are advised to protect themselves against MEV extraction.

### Default liquidation strategy

This strategy assumes your liquidator account owns FAssets they are willing to liquidate if such opportunity arises. Optional configuration can be set via extending your bot config with:

```
"liquidationStrategy": {
  "className": "DefaultLiquidationStrategy",
  "config": {
    "maxPriorityFeePerGas": number
  }
}
```

### Dex liquidation arbitrage strategy

For a given agent in liquidation, the liquidator will attempt to use the specified uniswap-v2 based DEX router and a flash lending contract to complete an arbitrage path. Assume the agent's vault collateral token is T (e.g. USDC). Then the strategy will:

1. Flash loan token T on the given flash lending service,
2. Swap the token T for the agent's f-asset on the given DEX router,
3. Liquidate the agent by burning obtained f-assets and receiving token T along with rewards in the native token,
4. Swap the native token for token T on the given DEX router,
5. Repay token T flash loan.

The strategy is implemented in the [LiquidationStrategy.ts](../../packages/fasset-bots-core/src/actors/plugins/LiquidationStrategy.ts) file.

Configure this strategy by deploying your own [Liquidator.sol](../../packages/fasset-liquidator/contracts/Liquidator.sol) contract, and extend the bot config with
```
"liquidationStrategy": {
  "className": "DefaultLiquidationStrategy",
  "config": {
    "address": "<address of deployed contract>"
  }
}
```
Additionally the configuration can override the default parameters:
```
{
  maxPriorityFeePerGas: number,
  maxAllowedSlippage: number;
  maxFlashFee: number;
  flashLender: "string";
  dexRouter: "string";
}
```
