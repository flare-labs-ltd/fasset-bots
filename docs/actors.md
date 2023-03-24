# Actors in FAsset system

## Agent

Agent is the main player in the FAsset system. Agent supplies collateral that is backing minted FAssets.
Agent operate against minters and redeemers. Minter pays the Agent in underlying asset for the right to utilise Agent's collateral for minting. In this process underlying assets (BTC, XRP, ...) are paid and FAssets (FBTC, FXRP, ...) are minted on top of native chain.
A redeemer does the opposite. It sends FAssets to the system, system burns those FAssets and redeemer receives the underlying asset in return.

File [`AgentBot.ts`](../src/actors/AgentBot.ts) contains framework for such an actor in FAsset system.

### Create an Agent

Agent gets created with method called `create(rootEm: EM, context: IAssetBotContext, ownerAddress: string, notifier: Notifier)`. This method creates an Agent on native chain and stores agent data in persistent state `AgentEntity()` in [`agent.ts`](../src/entities/agent.ts).

### Native chain events tracking:

- *CollateralReserved*: stores minting data in persistent state `AgentMinting` in [`agent.ts`](../src/entities/agent.ts).
- *CollateralReservationDeleted*: sets minting state of previously stored minting to [`AgentMintingState.DONE`](../src/entities/agent.ts).
- *MintingExecuted*: sets minting state of previously stored minting to [`AgentMintingState.DONE`](../src/entities/agent.ts).
- *RedemptionRequested*: stores redemption data in persistent state `AgentRedemption` in [`agent.ts`](../src/entities/agent.ts).
- *RedemptionDefault*: sets redemption state of previously stored redemption to [`AgentRedemptionState.DONE`](../src/entities/agent.ts) and sends notification about defaulted redemption.
- *RedemptionFinished*: sets redemption state of previously stored redemption to [`AgentRedemptionState.DONE`](../src/entities/agent.ts), checks free underlying balance and tops it up if necessary. See methods `checkUnderlyingBalance()` and `underlyingTopUp()`.
- *RedemptionPaymentFailed*: sends notification about failed redemption (failed due to agent's fault).
- *RedemptionPaymentBlocked*: sends notification about blocked redemption (failed due to redeemer's fault).
- *AgentDestroyed*: sets agent status in persistent state to `false`.
- *PriceEpochFinalized*: automatically tops up collateral if CR is too low due to price changes. Send notification about successful or unsuccessful collateral top up. See method `checkAgentForCollateralRatioAndTopUp()`.
- *AgentInCCB*: sends notification about Agent being in Collateral Call Band. In order to avoid further liquidation, Agent should reach healthy state as soon as possible.
- *LiquidationStarted*: sends notification about liquidation being started.
- *LiquidationPerformed*: sends notification about liquidation being performed.
- *UnderlyingFreeBalanceNegative*: sends notification about full liquidation being started.
- *DuplicatePaymentConfirmed*: sends notification about full liquidation being started.
- *IllegalPaymentConfirmed*: sends notification about full liquidation being started.


## Challenger

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

## Liquidator

File [`Liquidator.ts`](../src/actors/Liquidator.ts) contains framework for such an actor in FAsset system.
It tracks following events on native chain:

- *PriceEpochFinalized*
- *MintingExecuted*

After each event it checks Agent's position and triggers liquidation until Agent reaches healthy position. In order to trigger liquidation, Liquidator is required to hold FAssets and in return it gets paid in agent's collateral with some premium.

## System keeper

System keeper works is in a way similar as Liquidator. It tracks the same events on native chain. After each event it checks Agent's position and either starts or ends liquidation process.

File [`SystemKeeper.ts`](../src/actors/SystemKeeper.ts) contains framework for such an actor in FAsset system.
It tracks following events on native chain:

- *PriceEpochFinalized*
- *MintingExecuted*
