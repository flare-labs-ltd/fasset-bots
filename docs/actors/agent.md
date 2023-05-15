# AgentBot

Agent is the main player in the FAsset system. Agent supplies collateral that is backing minted FAssets. Agent operate against minters and redeemers. Minter pays the Agent in underlying asset for the right to utilise Agent's collateral for minting. In this process underlying assets (BTC, XRP, ...) are paid and FAssets (FBTC, FXRP, ...) are minted on top of native chain.
A redeemer does the opposite. It sends FAssets to the system, system burns those FAssets and redeemer receives the underlying asset in return.

File [AgentBot.ts](../../src/actors/AgentBot.ts) contains framework for such bot AgentBot in FAsset system.

## Prerequirements

User aka **Owner** needs:

- **native address** with funds
- **underlying address** with funds
- to create [**initial agent’s settings**](../../src/config/BotConfig.ts)
```
export interface AgentSettingsConfig {
    class1FtsoSymbol: string,
    feeBIPS: string,
    poolFeeShareBIPS: string,
    mintingClass1CollateralRatioConstant: number,
    mintingPoolCollateralRatioConstant: number,
    poolExitCollateralRatioConstant: number,
    buyFAssetByAgentFactorBIPS: string,
    poolTopupCollateralRatioConstant: number,
    poolTopupTokenPriceFactorBIPS: string
}
```
- to create [**runConfig**](../../src/config/BotConfig.ts)
```
export interface RunConfig {
    loopDelay: number;
    nativeChainInfo: NativeChainInfo;
    chainInfos: BotChainInfo[];
    ormOptions: CreateOrmOptions;
    // notifierFile: string;
    // either one must be set
    addressUpdater?: string;
    contractsJsonFile?: string;
}
```
- to set environment **.env** in root directory
```
# XRP
XRP_URL_WALLET=https://s.altnet.rippletest.net:51234
# DB ENCRYPTION
WALLET_ENCRYPTION_PASSWORD=
# NATIVE CHAIN i.e. COSTON2
ATTESTER_BASE_URLS="https://attestation-coston2.aflabs.net/attestation-client/"
RPC_URL=https://coston2-api.flare.network/ext/bc/C/rpc
STATE_CONNECTOR_ADDRESS=0x1000000000000000000000000000000000000001
ATTESTATION_CLIENT_ADDRESS=0x8858eeB3DfffA017D4BCE9801D340D36Cf895CCf
OWNER_ADDRESS=
OWNER_PRIVATE_KEY=
# INDEXERS
INDEXER_XRP_WEB_SERVER_URL=
INDEXER_XRP_API_KEY=
# UNDERLYING CHAIN
OWNER_UNDERLYING_ADDRESS="OwnerUnderlyingAddress"
OWNER_UNDERLYING_PRIVATE_KEY="OwnerUnderlyingPrivateKey"
# RUN CONFIG PATH
RUN_CONFIG_PATH="./run-config/run-config-coston2-with-contracts.json"
# DEFAULT AGENT SETTINGS PATH
DEFAULT_AGENT_SETTINGS_PATH="./run-config/agent-settings-config.json"
```
- to run [**./run-agents.ts**](../../src/run-agent.ts) -> creates agent and stores relevant data to persistent state, creates asset context, and starts observing events for agents


## Owner's methods
Via commandline interface Owner can operate with following commands:

- **Create** agent vault
- **Deposit class1** to agent vault
- **Buy pool collateral** for agent vault
- **Add agent vault to available list**
- **Remove agent from available list**
- **Withdraw class1** funds from agent vault (announcement)
- **Self close** agent vault
- **Destroy** agent vault
- [TODO] Perform underlying top up
- [TODO] Redeem collateral pool tokens


## AgentBot Automation
The **runStep** method is responsible for managing all relevant Agent events and comprises:
- **handleEvents**: checks if there are any new events since last time the method run
- **handleOpenMintings** and **handleOpenRedemptions**: checks if there are any open mintings or open redemptions that need to be handled
- **handleAgentsWaitingsAndCleanUp** checks if there are any pending actions, which need upfront announcement, ready for an execution

### handleEvents

- **CollateralReserved**:
    - stores minting data in persistent state `AgentMinting`
    -   sets minting state to `STARTED`
- **CollateralReservationDeleted** and **MintingExecuted**:
    - set minting state of previously stored minting to `DONE`
- **RedemptionRequested**:
    - stores redemption data in persistent state `AgentRedemption`
    - sets redemption state to `STARTED`
- **RedemptionDefault**:
    - sends notification about defaulted redemption
- **RedemptionPerformed**:
    - sets redemption state of previously stored redemption to `DONE`
    - sends notification about redemption being performed
    - checks agent's underlying balance and tops it up from Owner's underlying address if necessary
    - checks Owner's underlying balance and sends notification if it is low
- **RedemptionPaymentFailed** and **RedemptionPaymentBlocked**:
    - same as in RedemptionPerformed, but sends notification about failed redemption (failed due to agent's fault or redeemer's fault).
- **AgentDestroyed**:
    - sets Agent’s status in persistent state to `false`
- **PriceEpochFinalized**:
    - automatically tops up both or one of the collaterals if both or either CR is too low due to price changes
    - sends notification to Owner about successful or unsuccessful collateral top up or about low founds on Owner's native address
- **AgentInCCB**:
    - sends notification to Owner about Agent being in Collateral Call Band
- **LiquidationStarted**:
    - sends notification to Owner about liquidation being started
- **LiquidationPerformed**:
    - sends notification to Owner about liquidation being performed
- **UnderlyingBalanceTooLow**, **DuplicatePaymentConfirmed** and **IllegalPaymentConfirmed**:
    - send notification to Owner about full liquidation being started


### handleOpenMintings
Minting should generally follow flow: *collateral reservation -> minter pays -> minter requests proof -> minter executes minting*. Which means, that no additional actions are needed by AgentBot. But it could also happen that minter does not pay or does not execute minting. In that case Agent's collateral would stay locked. To avoid such cases AgentBot does following checks.

For every minting in state `STARTED` it checks if proof expired in indexer:
- If proof did NOT expire and time for payment on underlying chain run out:
    -   AgentBot queries indexer for transaction with minting payment reference
        -   If transaction exists (corner case):
            - AgentBot requests for payment proof
            - Sets minting state to `REQUEST_PAYMENT_PROOF`
        -   If transaction DOES NOT exist
            -   AgentBot requests for referenced payment nonexistence proof proof
            -   Sets minting state to `REQUEST_NON_PAYMENT_PROOF`
- If proof expired (corner case)
    - AgentBot calls *unstickMinting*
    - Sets minting state to `DONE`
    - Sends notification to Owner

For every minting in state `REQUEST_PAYMENT_PROOF`:
    - AgentBot obtains payment proof
    - Calls *executesMinting*
    - Sets minting state to `DONE`

For every minting in state `REQUEST_NON_PAYMENT_PROOF`:
    - AgentBot obtains referenced payment nonexistence proof
    - Executes *mintingPaymentDefault*
    - Sets minting state to `DONE`


### handleOpenRedemptions
Redemption should generally follow flow: *redemption request -> agent pays -> agent requests proof -> agent confirms redemption payment*.
But it could also happen that payment proof expired in indexer (very unlikely).

For every redemption in state `STARTED` it checks if proof expired in indexer:
- If proof did NOT expire:
    - AgentBot performs payment
    - Sets redemption state to `PAID`
- If proof did expired (corner case):
    - AgentBot *finishRedemptionWithoutPayment*
    - Sets redemption state to `DONE`

For every redemption in state `PAID` it checks if proof expired in indexer:
- If proof did NOT expire:
    - AgentBot request payment proof
    - Sets redemption state to `REQUESTED_PROOF`
- If proof did expired (corner case):
    - AgentBot *finishRedemptionWithoutPayment*
    - Sets redemption state to `DONE`

For every redemption in state `REQUESTED_PROOF`:
- AgentBot obtains payment proof
- Calls *confirmRedemptionPayment*
- Sets redemption state to `DONE`


### handleAgentsWaitingsAndCleanUp
Due to their significant impact, some FAsset operations are subject to time locks. In this method, the AgentBot verifies if the time lock has expired and then executes any pending actions:
- **withdraw** collateral
- **exit Agent's available list**
- **update Agent's setting**
- **destroy** Agent
