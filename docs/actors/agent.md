# AgentBot

Agent is the main player in the FAsset system. It supplies collateral that is backing minted FAssets and operates against minters and redeemers. Minter pays the Agent in the underlying asset, such as BTC or XRP, to utilise Agent's collateral for minting FAssets like FBTC and FXRP on the native chain. Conversely, redeemer sends FAssets to the system, prompting the system to burn those FAssets and return the underlying asset to the redeemer.

File [AgentBot.ts](../../packages/fasset-bots-core/src/actors/AgentBot.ts) contains framework for such bot AgentBot in FAsset system.

## AgentBot Automation

The **runStep** method is responsible for managing all relevant Agent events and comprises:

-   **handleEvents**: checks if there are any new native events since last time the method run
-   **handleOpenRedemptions**: checks if there are any open redemptions that need to be handled
-   **handleAgentsWaitingsAndCleanUp** checks if there are any pending actions, which need upfront announcement, ready for an execution
-   **handleCornerCases**: once a day checks if there are any open mintings or redemptions stuck on corner case

### handleEvents

-   **CollateralReserved**:
    -   stores minting data in persistent state `AgentMinting`
    -   sets minting state to `STARTED`
    -   sends notification
-   **CollateralReservationDeleted** and **MintingExecuted**:
    -   set minting state of previously stored minting to `DONE`
    -   sends notification
-   **RedemptionRequested**:
    -   stores redemption data in persistent state `AgentRedemption`
    -   sets redemption state to `STARTED`
    -   sends notification
-   **RedemptionDefault**:
    -   sends notification about defaulted redemption
-   **RedemptionPerformed**:
    -   sets redemption state of previously stored redemption to `DONE`
    -   sends notification about redemption being performed
    -   checks agent's underlying balance and tops it up from Owner's underlying address if necessary
    -   checks Owner's underlying balance and sends notification if it is low
-   **RedemptionPaymentFailed** and **RedemptionPaymentBlocked**:
    -   same as in RedemptionPerformed, but sends notification about failed redemption (failed due to agent's fault or redeemer's fault).
-   **AgentDestroyed**:
    -   sets Agent’s status in persistent state to `false`
    -   sends notification
-   **PriceEpochFinalized**:
    -   automatically tops up both or one of the collaterals if both or either CR is too low due to price changes
    -   sends notification to Owner about successful or unsuccessful collateral top up or about low founds on Owner's native address
-   **AgentInCCB**:
    -   sends notification to Owner about Agent being in Collateral Call Band
-   **LiquidationStarted**:
    -   sends notification to Owner about liquidation being started
-   **LiquidationPerformed**:
    -   sends notification to Owner about liquidation being performed
-   **UnderlyingBalanceTooLow**, **DuplicatePaymentConfirmed** and **IllegalPaymentConfirmed**:
    -   send notification to Owner about full liquidation being started

### handleOpenRedemptions

Redemption should generally follow flow: _redemption request -> agent pays -> agent requests proof -> agent confirms redemption payment_.

For every redemption in state `STARTED` it checks if payment can be still done (if it satisfies redemption's requirements on last underlying payment block)

-   If it satisfies requirements:
    -   AgentBot performs payment
    -   Sets redemption state to `PAID`
    -   Sends notification

For every redemption in state `PAID`:

-   AgentBot request payment proof
-   Sets redemption state to `REQUESTED_PROOF`
-   Sends notification

For every redemption in state `REQUESTED_PROOF`:

-   AgentBot obtains payment proof
-   Calls _confirmRedemptionPayment_
-   Sets redemption state to `DONE`
-   Sends notification

### handleAgentsWaitingsAndCleanUp

Due to their significant impact, some FAsset operations are subject to time locks. In this method, the AgentBot verifies if the time lock has expired and then executes any pending actions:

-   withdraw collateral
-   exit Agent's available list
-   update Agent's setting
-   destroy Agent
-   confirm underlying withdrawal
-   cancel underlying withdrawal

### handleOpenMintings in handleCornerCases

Minting should generally follow flow: _collateral reservation -> minter pays -> minter requests proof -> minter executes minting_. Which means, that no additional actions are needed by AgentBot. But it could also happen that minter does not pay or does not execute minting. In that case Agent's collateral would stay locked. To avoid such cases AgentBot does following checks.

For every minting in state `STARTED` it checks if proof expired in indexer:

-   If proof did NOT expire and time for payment on underlying chain run out:
    -   AgentBot queries indexer for transaction with minting payment reference
        -   If transaction exists (corner case):
            -   AgentBot requests for payment proof
            -   Sets minting state to `REQUEST_PAYMENT_PROOF`
            -   Sends notification
        -   If transaction DOES NOT exist
            -   AgentBot requests for referenced payment nonexistence proof proof
            -   Sets minting state to `REQUEST_NON_PAYMENT_PROOF`
            -   Sends notification
-   If proof expired (corner case)
    -   AgentBot calls _unstickMinting_
    -   Sets minting state to `DONE`
    -   Sends notification to Owner

For every minting in state `REQUEST_PAYMENT_PROOF`:

-   AgentBot obtains payment proof
-   Calls _executesMinting_
-   Sets minting state to `DONE`
-   Sends notification

For every minting in state `REQUEST_NON_PAYMENT_PROOF`:

-   AgentBot obtains referenced payment nonexistence proof
-   Executes _mintingPaymentDefault_
-   Sets minting state to `DONE`
-   Sends notification

### handleOpenRedemptions in handleCornerCases

It could happen that payment proof expired in indexer (very unlikely).

For every redemption in state `STARTED`, `PAID` or `REQUESTED_PROOF` it checks if proof expired:

-   If proof did expired (corner case):
    -   AgentBot _finishRedemptionWithoutPayment_
    -   Sets redemption state to `DONE`
    -   Sends notification
