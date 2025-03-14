# AgentBot

The Agent is the main player in the FAsset system. It supplies collateral backing minted FAssets and operates against minters and redeemers. Minter pays the Agent in the underlying asset, such as BTC or XRP, to use the Agent's collateral for minting FAssets like FBTC and FXRP on the native chain. Conversely, the redeemer sends FAssets to the system, prompting the system to burn those FAssets and return the underlying asset to the redeemer.

File [AgentBot.ts](../../packages/fasset-bots-core/src/actors/AgentBot.ts) contains a framework for such bot AgentBot in the FAsset system.

## AgentBot Automation

The **runStep** method is responsible for managing all relevant Agent events and comprises:

- **handleEvents**: checks if there are any new native events since last time the method run
- **handleOpenRedemptions**: checks if there are any open redemptions that need to be handled
- **handleAgentsWaitingsAndCleanUp** checks if there are any pending actions, which need upfront announcement, ready for an execution
- **handleCornerCases**: once a day checks if there are any open mintings or redemptions stuck on corner case

### handleEvents

- **CollateralReserved**:
  - stores minting data in persistent state `AgentMinting`
  - sets minting state to `STARTED`
  - sends notification
- **CollateralReservationDeleted** and **MintingExecuted**:
  - set the minting state of previously stored minting to `DONE`
  - sends notification
- **RedemptionRequested**:
  - stores redemption data in persistent state `AgentRedemption`
  - sets redemption state to `STARTED`
  - sends notification
- **RedemptionDefault**:
  - sends notification about defaulted redemption
- **RedemptionPerformed**:
  - sets redemption state of previously stored redemption to `DONE`
  - sends notification about redemption being performed
  - checks Agent's underlying balance and tops it up from Owner's underlying address if necessary
  - checks Owner's underlying balance and sends a notification if it is low
- **RedemptionPaymentFailed** and **RedemptionPaymentBlocked**:
  - same as in RedemptionPerformed, but sends notification about failed redemption (failed due to Agent's fault or redeemer's fault).
- **AgentDestroyed**:
  - sets Agent’s status in the persistent state to `false`
  - sends notification
- **PriceEpochFinalized**:
  - automatically tops up both or one of the collaterals if both or either CR is too low due to price changes
  - sends a notification to Owner about successful or unsuccessful collateral top up or about low funds on Owner's native address
- **AgentInCCB**:
  - sends a notification to Owner about Agent being in Collateral Call Band
- **LiquidationStarted**:
  - sends a notification to Owner about liquidation being started
- **LiquidationPerformed**:
  - sends notification to Owner about liquidation being performed
- **UnderlyingBalanceTooLow**, **DuplicatePaymentConfirmed** and **IllegalPaymentConfirmed**:
  - send notification to Owner about full liquidation being started

### handleOpenRedemptions

Redemption should generally follow the flow: _redemption request -> agent pays -> agent requests proof -> agent confirms redemption payment_.

For every redemption in the state `STARTED`, it checks if payment can still be done (if it meets the redemption's requirements on the last underlying payment block)

- If it satisfies the requirements:
  - AgentBot performs payment
  - Sets redemption state to `PAID`
  - Sends notification

For every redemption in state `PAID`:

- AgentBot requests payment proof
- Sets redemption state to `REQUESTED_PROOF`
- Sends notification

For every redemption in state `REQUESTED_PROOF`:

- AgentBot obtains payment proof
- Calls _confirmRedemptionPayment_
- Sets redemption state to `DONE`
- Sends notification

### handleAgentsWaitingsAndCleanUp

Due to their significant impact, some FAsset operations are subject to time locks. In this method, the AgentBot verifies if the time lock has expired and then executes any pending actions:

- withdraw collateral
- exit Agent's available list
- update Agent's setting
- destroy Agent
- confirm the underlying withdrawal
- cancel the underlying withdrawal

### handleOpenMintings in handleCornerCases

Minting should generally follow the flow: _collateral reservation -> minter pays -> minter requests proof -> minter executes minting_. This means that AgentBot will not need to take any additional actions. But it could also happen that the minter does not pay or does not execute minting. In that case Agent's collateral would stay locked. To avoid such cases AgentBot does following checks.

For every minting in the state `STARTED` it checks if proof expired in the indexer:

- If proof did NOT expire and time for payment on the underlying chain ran out:
  - AgentBot queries indexer for transaction with the minting payment reference
    - If transaction exists (corner case):
      - AgentBot requests payment proof
      - Sets minting state to `REQUEST_PAYMENT_PROOF`
      - Sends notification
    - If the transaction DOES NOT exist
      - AgentBot requests for referenced payment nonexistence proof proof
      - Sets minting state to `REQUEST_NON_PAYMENT_PROOF`
      - Sends notification
- If proof expired (corner case)
  - AgentBot calls _unstickMinting_
  - Sets minting state to `DONE`
  - Sends notification to Owner

For every minting in state `REQUEST_PAYMENT_PROOF`:

- AgentBot obtains payment proof
- Calls _executesMinting_
- Sets minting state to `DONE`
- Sends notification

For every minting in state `REQUEST_NON_PAYMENT_PROOF`:

- AgentBot obtains referenced payment nonexistence proof
- Executes _mintingPaymentDefault_
- Sets minting state to `DONE`
- Sends notification

### handleOpenRedemptions in handleCornerCases

It could happen that payment proof expired in the indexer (very unlikely).

For every redemption in state `STARTED`, `PAID` or `REQUESTED_PROOF` it checks if proof expired:

- If proof did expire (corner case):
  - AgentBot _finishRedemptionWithoutPayment_
  - Sets redemption state to `DONE`
  - Sends notification
