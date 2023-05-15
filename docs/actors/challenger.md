# ChallengerBot

Challenger is essential for maintaining the FAsset system healthy. Challenger's role is to trigger any unhealthy state and to get paid in return. System funds (Agent's free collateral) will be utilised to pay a challenger that correctly report an unhealthy state.

File [`Challenger.ts`](../../src/actors/Challenger.ts) contains framework for such an actor in FAsset system.


## Prerequirements
User needs:
- *native address*
- [TODO] simplified version of IAssetBotContext
- [TODO] challengerBotConfig.ts (simplified version of BotConfig)
- [TODO] script to run it

### Initialization
Initially, the constructor takes in **runner** (ScopedRunner), **address** (native address), **state** (TrackedState) and **lastEventUnderlyingBlockHandled** as inputs:
```javascript
constructor(
       public runner: ScopedRunner,
       public address: string,
       public state: TrackedState,
       private lastEventUnderlyingBlockHandled: number
   ) { }
   ...
```
Finally, the Challenger populates following variables based on the received events:
- **activeRedemptions**: paymentReference => { agent vault address, requested redemption amount }
- **unconfirmedTransactions**: paymentReference => transaction hash
- **agentsByPool**: agentVaultAddress => (txHash => transaction)
- **challengedAgents**: agentVaultAddress


## ChallengerBot Automation
The **runStep** method is responsible for managing all relevant Agent events and comprises:
- **registerEvents**

### registerEvents
Initially, it triggers event handling in **parent** (TrackedState) with method **readUnhandledEvents**.

Secondly, it checks following events:
- **RedemptionRequested**:
    - stores new redemption in variable *activeRedemptions*
- **RedemptionPerformed**:
    - cleans up *transactionForPaymentReference* tracking
    - removes redemption from *activeRedemptions*
    - removes transaction from *unconfirmedTransactions*
    - tries to trigger negative balance challenger (*checkForNegativeFreeBalance*)
- **RedemptionPaymentBlocked**:
    - same as in *RedemptionPerformed*
- **RedemptionPaymentFailed**:
    - same as in *RedemptionPerformed*
- **UnderlyingWithdrawalConfirmed**:
    - removes transaction from *unconfirmedTransactions*
    - tries to trigger negative balance challenger (*checkForNegativeFreeBalance*)

Finally, it checks underlying events:
- **getTransactionsWithinBlockRange**
    - for every found transaction:
        - adds transaction to *unconfirmedTransactions*
        - tries to trigger illegal transaction challenge (*checkForIllegalTransaction*)
        - tries to trigger double payment challenger (*checkForDoublePayment*)
        - tries to trigger negative balance challenger (*checkForNegativeFreeBalance*)


