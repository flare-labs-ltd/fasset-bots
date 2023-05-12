# Challenger

Challenger is essential for maintaining the FAsset system healthy. Challenger's role is to trigger any unhealthy state and to get paid in return. System funds (Agent's free collateral) will be utilised to pay a challenger that correctly report an unhealthy state.

File [`Challenger.ts`](../src/actors/Challenger.ts) contains framework for such an actor in FAsset system.
It tracks following events on native chain:

- *RedemptionRequested*
- *RedemptionFinished*
- *RedemptionPerformed*: runs NegativeFreeBalance challenge.
- *RedemptionPaymentBlocked*: runs NegativeFreeBalance challenge.
- *RedemptionPaymentFailed*: runs NegativeFreeBalance challenge.
- *UnderlyingWithdrawalConfirmed*: runs NegativeFreeBalance challenge.

It tracks all outgoing transactions from Agent's underlying address and tries to run following challenges:

- *IllegalPayment*: an unexpected transaction from the agent's underlying address was proved. Whole agent's position goes into liquidation.
- *DoublePayment*: two transactions with same payment reference, both from the agent's underlying address, were proved. Whole agent's position goes into liquidation.
- *NegativeFreeBalance*: on or multiple legal payments from the agent's underlying address whose outgoing amount together exceed the sum of all redemption values plus the total free balance, were proved. Whole agent's position goes into liquidation.



