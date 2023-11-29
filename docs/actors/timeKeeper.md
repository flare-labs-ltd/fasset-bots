# TimeKeeperBot

Time keeper proves that underlying block with given number and timestamp exists and updates the current underlying block info if the provided data is higher. This bot should be used by **minters** before minting and by **agents** regularly to prevent current block being too outdated, which gives too short time for minting or redemption payment.

File [TimeKeeper.ts](../src/actors/TimeKeeper.ts) contains framework for such actor in FAsset system.

### Initialization

The constructor takes in **address** (native address) and **asset context** (IAssetActorContext) as inputs:

```javascript
   constructor(
        public address: string,
       public context: IAssetActorContext,
       public intervalInMs: number
   ) { }
```

## TimeKeeperBot Automation

The **run** method is responsible for managing proofs and updates. It set a recurring task of proving and updating underlying blocks every minute.
