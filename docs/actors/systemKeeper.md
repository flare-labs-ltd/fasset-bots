# System keeper

System keeper works is in a way similar as Liquidator. It tracks the same events on native chain. After each event it checks Agent's position and either starts or ends liquidation process.

File [`SystemKeeper.ts`](../src/actors/SystemKeeper.ts) contains framework for such an actor in FAsset system.
It tracks following events on native chain:

- *PriceEpochFinalized*
- *MintingExecuted*
