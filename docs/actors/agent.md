# Agent

Agent is the main player in the FAsset system. Agent supplies collateral that is backing minted FAssets. Agent operate against minters and redeemers. Minter pays the Agent in underlying asset for the right to utilise Agent's collateral for minting. In this process underlying assets (BTC, XRP, ...) are paid and FAssets (FBTC, FXRP, ...) are minted on top of native chain.
A redeemer does the opposite. It sends FAssets to the system, system burns those FAssets and redeemer receives the underlying asset in return.

File [`AgentBot.ts`](../src/actors/AgentBot.ts) contains framework for such bot AgentBot in FAsset system.

## Create an Agent

AgentBot gets created with method called `create(rootEm: EM, context: IAssetBotContext, ownerAddress: string, notifier: Notifier)`. This method creates an Agent on native chain and stores AgentBot data in persistent state `AgentEntity()` as in [`agent.ts`](../src/entities/agent.ts).

## Running steps of AgentBot

Method `runStep(rootEm: EM)` is incharge for handling all of the relevant Agent events. Firstly, it checks if there are any new events since last time the method run - `handleEvents(rootEm)`. Then, it checks if there are any open mintings or open redemptions that need actions - `handleOpenMintings(rootEm)` and `handleOpenRedemptions(rootEm)`. Lastly, checks if there are any pending actions, which need upfront announcement, ready for an execution `handleAgentsWaitingsAndCleanUp(rootEm)`.

## `handleEvents`

- *CollateralReserved*:
    - stores minting data in persistent state `AgentMinting` as in [`agent.ts`](../src/entities/agent.ts).
- *CollateralReservationDeleted* and *MintingExecuted* :
    - sets minting state of previously stored minting to [`AgentMintingState.DONE`](../src/entities/agent.ts).
- *RedemptionRequested*:
    - stores redemption data in persistent state `AgentRedemption` as in [`agent.ts`](../src/entities/agent.ts).
- *RedemptionDefault*:
    - sends notification about defaulted redemption.
- *RedemptionPerformed*:
    - sets redemption state of previously stored redemption to [`AgentRedemptionState.DONE`](../src/entities/agent.ts),
    - checks agent's underlying balance and tops it up from owner's underlying address if necessary (see methods `checkUnderlyingBalance()` and `underlyingTopUp()`),
    - checks owner's underlying balance and sends notification if it is low,
    - sends notification about redemption being performed.
- *RedemptionPaymentFailed* and *RedemptionPaymentBlocked*:
    - same as in *RedemptionPerformed*, but sends notification about failed redemption (failed due to agent's fault or redeemer's fault).
- *AgentDestroyed*:
    - sets agent status in persistent state to `false`.
- *PriceEpochFinalized*:
    - automatically tops up both or one of the collaterals if both or either CR is too low due to price changes,
    - sends notification to owner about successful or unsuccessful collateral top up or about low founds on owner's native address. See method `checkAgentForCollateralRatioAndTopUp()`.
- *AgentInCCB*:
    - sends notification to owner about Agent being in Collateral Call Band. In order to avoid further liquidation, Agent should reach healthy state as soon as possible.
- *LiquidationStarted*:
    - sends notification to owner about liquidation being started.
- *LiquidationPerformed*:
    - sends notification to owner about liquidation being performed.
- *UnderlyingBalanceTooLow*, *DuplicatePaymentConfirmed* and *IllegalPaymentConfirmed*:
    - sends notification to owner about full liquidation being started.

### `handleOpenMintings`

Minting should generally follow flow: collateral reservation -> minter pays -> minter requests proof -> minter executes minting.
But it could also happen that minter does not pay or does not execute minting. In that case agent's collateral would stay locked. To avoid such cases agentBot does following checks:
- if proof did NOT expired in indexer:
    - if time for payment on underlying chain run out:
        - if proof for payment exists:
            -  calls `executeMinting`,
            - sets minting minting to [`AgentMintingState.DONE`],
        - if proof for non payment exists:
            -  calls `mintingPaymentDefault`,
            - sets minting minting to [`AgentMintingState.DONE`].

- if proof has expired in indexer:
    - calls `unstickMinting`,
    - sets minting minting to [`AgentMintingState.DONE`],
    - sends notification about it to owner.

### `handleOpenRedemptions`

Redemption should generally follow flow: redemption request -> agent pays -> agent requests proof -> agent confirms redemption payment.
But it could also happen that payment proof expired in indexer (very unlikely). In that case agentBot calls `finishRedemptionWithoutPayment` and sets redemption state to [`AgentRedemptionState.DONE`].

### `handleAgentsWaitingsAndCleanUp`

Certain FAsset operation are timelocked due to their impact. In this method AgentBot checks if timelock is over and executes pending actions: such as withdraw collateral, exit agent's available list, update agent's setting and destruct agent.