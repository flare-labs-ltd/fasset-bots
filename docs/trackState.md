# TrackedState

Files [TrackedState](../src/state/TrackedState.ts) and [TrackedAgentState](../src/state/TrackedAgentState.ts) contain framework for non-persistent state tracking.

TrackedState represents non-persistent state that monitors native events and calculates and sets specific variables essential for the _challenger_ and _liquidator_ to respond appropriately.

### Initialization

Initially, the constructor takes in **asset context** and **lastEventBlockRead** as inputs:

```javascript
   constructor(
       public context: IAssetActorContext,
       private lastEventBlockRead: number
   ) { }
```

Secondly, TrackedState is initialized, and the following variables are set:

-   assetManagerSettings
-   liquidationStrategySettings
-   collateralTokens
-   fAssetSupply
-   prices
-   trustedPrices

Finally, the TrackedState populates the tracked agent variables and tracked agent state variables ([see below](#trackedAgentState)) based on the received events:

-   **agents**: agent_address => TrackedAgentState
-   **agentsByUnderlying**: underlying_address => TrackedAgentState
-   **agentsByPool**: pool_address => TrackedAgentState

### registerStateEvents

`registerStateEvents` method checks if there are any new native events since last time the method run. Checked events are following:

-   PriceEpochFinalized
-   SettingChanged
-   SettingArrayChanged
-   AgentSettingChanged
-   MintingExecuted
-   RedemptionRequested
-   SelfClose
-   LiquidationPerformed
-   CollateralTypeAdded
-   CollateralRatiosChanged
-   CollateralTypeDeprecated
-   AgentVaultCreated
-   AgentDestroyed
-   AgentInCCB
-   LiquidationStarted
-   FullLiquidationStarted
-   LiquidationEnded
-   AgentDestroyAnnounced
-   AgentAvailable
-   AvailableAgentExited
-   CollateralReserved
-   MintingPaymentDefault
-   CollateralReservationDeleted
-   RedemptionPerformed
-   RedemptionDefault
-   RedemptionPaymentBlocked
-   RedemptionPaymentFailed
-   RedeemedInCollateral
-   UnderlyingBalanceToppedUp
-   UnderlyingWithdrawalAnnounced
-   UnderlyingWithdrawalConfirmed
-   UnderlyingWithdrawalCancelled
-   DustChanged
-   Transfer

# TrackedAgentState

### Initialization

Firstly, **parent** (TrackedState) and **data** (InitialAgentData: agentVault, underlyingAddress, contingencyPool, vaultCollateralToken, feeBIPS, poolFeeShareBIPS, mintingVaultCollateralRatioBIPS, mintingPoolCollateralRatioBIPS, poolExitCollateralRatioBIPS, buyFAssetByAgentFactorBIPS, poolTopupCollateralRatioBIPS, poolTopupTokenPriceFactorBIPS) are input into constructor:

```javascript
   constructor(
       public parent: TrackedState,
       data: InitialAgentData
   ) { }
```

Secondly, TrackedAgentState is initialized and following variables are set from **agentInfo**:

-   status
-   publiclyAvailable
-   totalPoolCollateralNATWei
-   totalVaultCollateralWei[agentInfo.vaultCollateralToken]
-   ccbStartTimestamp
-   liquidationStartTimestamp
-   announcedUnderlyingWithdrawalId
-   reservedUBA
-   mintedUBA
-   redeemingUBA
-   poolRedeemingUBA
-   dustUBA
-   underlyingBalanceUBA
-   agentSettings.vaultCollateralToken
-   agentSettings.feeBIPS
-   agentSettings.poolFeeShareBIPS
-   agentSettings.mintingVaultCollateralRatioBIPS
-   agentSettings.mintingPoolCollateralRatioBIPS
-   agentSettings.poolExitCollateralRatioBIPS
-   agentSettings.buyFAssetByAgentFactorBIPS
-   agentSettings.poolTopupCollateralRatioBIPS
-   agentSettings.poolTopupTokenPriceFactorBIPS

Lastly, TrackedAgentState variables are appropriately calculate and stored after every intercepted event in TrackedState.
