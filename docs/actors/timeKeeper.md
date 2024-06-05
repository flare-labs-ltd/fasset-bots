# TimeKeeperBot

The Time Keeper proves that the underlying block with a given number and timestamp exists and updates the current underlying block info if the provided data is higher. **Minters** should use this bot regularly before minting and by **agents** to prevent the current block being too outdated, which gives too short time for minting or redemption payment.

File [TimeKeeper.ts](../../packages/fasset-bots-core/src/actors/TimeKeeper.ts) contains a framework for such an actor in the FAsset system.

## Initialization

The constructor takes in **address** (native address) and **asset context** (IAssetActorContext) as inputs:

```javascript
   constructor(
        public address: string,
       public context: IAssetActorContext,
       public intervalInMs: number
   ) { }
```

## TimeKeeperBot Automation

The **run** method in TimeKeeperBot Automation is responsible for managing proofs and updates. It sets a recurring task of proving and updating underlying blocks every minute, ensuring the system's data is always current.
