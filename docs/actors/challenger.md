# ChallengerBot

Challenger is essential for maintaining the FAsset system healthy. Challenger's role is to trigger any unhealthy state and to get paid in return. System funds (Agent's free collateral) will be utilised to pay a challenger that correctly report an unhealthy state.

File [Challenger.ts](../../src/actors/Challenger.ts) contains framework for such actor in FAsset system.


## Prerequirements
User needs:
- *native address*
- to create [**running configuration**](../../src/config/BotConfig.ts)
```javascript
export interface TrackedStateRunConfig {
    nativeChainInfo: NativeChainInfo;
    chainInfos: BotChainInfo[];
    // either one must be set
    addressUpdater?: string;
    contractsJsonFile?: string;
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
# INDEXERS
INDEXER_XRP_WEB_SERVER_URL=
INDEXER_XRP_API_KEY=
# RUN CONFIG PATH
RUN_CONFIG_PATH="./run-config/run-simplified-config-coston2-with-contracts.json"
```
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

Secondly, it checks following native events:
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


