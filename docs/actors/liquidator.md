# Liquidator

File [`Liquidator.ts`](../src/actors/Liquidator.ts) contains framework for such an actor in FAsset system.
It tracks following events on native chain:

- *PriceEpochFinalized*
- *MintingExecuted*

After each event it checks Agent's position and triggers liquidation until Agent reaches healthy position. In order to trigger liquidation, Liquidator is required to hold FAssets and in return it gets paid in agent's collateral with some premium.