# ChallengerBot

The Challenger is essential for maintaining the FAsset system's health. The challenger's role is to trigger any unhealthy state and to get paid in return. System funds (the Agent's vault collateral) will be utilised to pay a challenger who correctly reports an unhealthy state.

The file [Challenger.ts](../../packages/fasset-bots-core/src/actors/Challenger.ts) contains a framework for such an actor in the FAsset system.

## Initialization

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

Finally, the Challenger populates the following variables based on the received events:

- **activeRedemptions**: paymentReference => { agent vault address, requested redemption amount }
- **unconfirmedTransactions**: paymentReference => transaction hash
- **agentsByPool**: agentVaultAddress => (txHash => transaction)
- **challengedAgents**: agentVaultAddress

## ChallengerBot Automation

The **runStep** method is responsible for managing all relevant Agent events and comprises:

- **registerEvents**

### registerEvents

Initially, it triggers event handling in **parent** (TrackedState) with method **readUnhandledEvents**.

Secondly, it checks the following native events:

- **RedemptionRequested**:
  - stores new redemption in variable _activeRedemptions_
- **RedemptionPerformed**:
  - cleans up _transactionForPaymentReference_ tracking
  - removes redemption from _activeRedemptions_
  - removes transaction from _unconfirmedTransactions_
  - tries to trigger negative balance challenger (_checkForNegativeFreeBalance_)
- **RedemptionPaymentBlocked**:
  - same as in _RedemptionPerformed_
- **RedemptionPaymentFailed**:
  - same as in _RedemptionPerformed_
- **UnderlyingWithdrawalConfirmed**:
  - removes transaction from _unconfirmedTransactions_
  - tries to trigger negative balance challenger (_checkForNegativeFreeBalance_)

Finally, it checks underlying events:

- **getTransactionsWithinBlockRange**
  - for every found transaction:
    - adds transaction to _unconfirmedTransactions_
    - tries to trigger illegal transaction challenge (_checkForIllegalTransaction_)
    - tries to trigger double payment challenger (_checkForDoublePayment_)
    - tries to trigger negative balance challenger (_checkForNegativeFreeBalance_)
