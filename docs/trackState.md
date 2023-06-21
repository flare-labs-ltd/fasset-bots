# TrackedState

Files [TrackedState](../src/state/TrackedState.ts) and [TrackedAgentState](../src/state/TrackedAgentState.ts) contain framework for such state tracking.

TrackedState represents non-persistent state that monitors native events and calculates and sets specific variables essential for the *challenger* and *liquidator* to respond appropriately.

### Initialization
Initially, the constructor takes in **asset context** and **lastEventBlockHandled** as inputs:
```javascript
   constructor(
       public context: IAssetTrackedStateContext,
       private lastEventBlockHandled: number
   ) { }
```

Secondly, TrackedState is initialized, and the following variables are set:
- assetManagerSettings
- liquidationStrategySettings
- collateralTokens
- fAssetSupply
- prices
- trustedPrices

Finally, the TrackedState populates the tracked agent variables based on the received events:
- **agents**: agent_address => TrackedAgentState
- **agentsByUnderlying**: underlying_address => TrackedAgentState
- **agentsByPool**: pool_address => TrackedAgentState

### registerStateEvents
- PriceEpochFinalized
- SettingChanged
- SettingArrayChanged
- AgentSettingChanged
- MintingExecuted
- RedemptionRequested
- SelfClose
- LiquidationPerformed
- CollateralTypeAdded
- CollateralRatiosChanged
- CollateralTypeDeprecated
- AgentCreated
- AgentDestroyed
- AgentInCCB
- LiquidationStarted
- FullLiquidationStarted
- LiquidationEnded
- AgentDestroyAnnounced
- AgentAvailable
- AvailableAgentExited
- CollateralReserved
- MintingPaymentDefault
- CollateralReservationDeleted
- RedemptionPerformed
- RedemptionDefault
- RedemptionPaymentBlocked
- RedemptionPaymentFailed
- UnderlyingBalanceToppedUp
- UnderlyingWithdrawalAnnounced
- UnderlyingWithdrawalConfirmed
- UnderlyingWithdrawalCancelled
- DustChanged
- Transfer


# TrackedAgentState

### Initialization
Firstly, **parent** (TrackedState), **agent’s vault address**, **agent’s underlying address** and **agent’s collateral pool address** are input into constructor:
```javascript
   constructor(
       public parent: TrackedState,
       public vaultAddress: string,
       public underlyingAddress: string,
       public collateralPoolAddress: string
   ) { }
```

Secondly, TrackedAgentState is initialized and following variables are set from **agentInfo**:
- status
- publiclyAvailable
- totalPoolCollateralNATWei
- totalClass1CollateralWei[agentInfo.class1CollateralToken]
- ccbStartTimestamp
- liquidationStartTimestamp
- announcedUnderlyingWithdrawalId
- reservedUBA
- mintedUBA
- redeemingUBA
- poolRedeemingUBA
- dustUBA
- underlyingBalanceUBA
- agentSettings.class1CollateralToken
- agentSettings.feeBIPS
- agentSettings.poolFeeShareBIPS
- agentSettings.mintingClass1CollateralRatioBIPS
- agentSettings.mintingPoolCollateralRatioBIPS
- agentSettings.poolExitCollateralRatioBIPS
- agentSettings.buyFAssetByAgentFactorBIPS
- agentSettings.poolTopupCollateralRatioBIPS
- agentSettings.poolTopupTokenPriceFactorBIPS
