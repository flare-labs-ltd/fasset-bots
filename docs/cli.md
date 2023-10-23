# CLI `agent-bot`

## Setup

Configuration and environment file must be provided, before running cli commands. See [Agent bot configuration](./config.md#agent-bot-configuration-file) and [Agent bot environment](./config.md#agent-bot-environment-file) for more.

## How to use

Usage: `yarn agent-bot [command] <arg> -f [fAssetSymbol]`

Available commands:

-   `create` - create new agent vault
-   `depositVaultCollateral <agentVault> <amount>` - deposit vault collateral to agent vault from owner's address");
-   `buyPoolCollateral <agentVault> <amount>` - add pool collateral and agent pool tokens
-   `enter <agentVault>` - enter available agent's list
-   `announceExit <agentVault>` - announce exit available agent's list
-   `exit <agentVault>` - exit available agent's list
-   `updateAgentSetting <agentVault> <agentSettingName> <agentSettingValue> `- set agent's settings
-   `withdrawVaultCollateral <agentVault> <amount>` - withdraw amount from agent vault to owner's address
-   `withdrawPoolFees <agentVault> <amount>` - withdraw pool fees from pool to owner's address
-   `poolFeesBalance <agentVault>` - pool fees balance of agent
-   `selfClose <agentVault> <amountUBA>` - self close agent vault with amountUBA of FAssets
-   `close <agentVault>` - close agent vault
-   `announceUnderlyingWithdrawal <agentVault>` - announce underlying withdrawal and get needed payment reference
-   `performUnderlyingWithdrawal <agentVault> <amount> <destinationAddress> <paymentReference>` - perform underlying withdrawal and get needed transaction hash
-   `confirmUnderlyingWithdrawal <agentVault> <transactionHash>` - confirm underlying withdrawal with transaction hash
-   `cancelUnderlyingWithdrawal <agentVault>` - cancel underlying withdrawal announcement
-   `listAgents` - list active agent from persistent state
-   `delegatePoolCollateral <agentVault> <recipient> <bips>`- delegate pool collateral, where <bips> is basis points (1/100 of one percent)
-   `undelegatePoolCollateral <agentVault>`- undelegate pool collateral
-   `createUnderlyingAccount` - create underlying account
-   `freeVaultCollateral` - get free vault collateral
-   `freePoolCollateral` - get free pool collateral
-   `freeUnderlying` - get free underlying balance
-   `switchVaultCollateral` - switch vault collateral
-   `upgradeWNat` - upgrade WNat contract

### Agent's settings:

For more about agent's settings check [AgentSettings.sol](https://gitlab.com/flarenetwork/fasset/-/blob/main/contracts/userInterfaces/data/AgentSettings.sol) in Fasset repository.

-   feeBIPS
-   poolFeeShareBIPS
-   mintingVaultCollateralRatioBIPS
-   mintingPoolCollateralRatioBIPS
-   buyFAssetByAgentFactorBIPS
-   poolExitCollateralRatioBIPS
-   poolTopupCollateralRatioBIPS
-   poolTopupTokenPriceFactorBIPS

# CLI `api-key`

## How to use

Usage: `yarn api-key [command]`

Available commands:

-   `create` - create api key and its hash

# CLI `user-bot`

## Setup

Configuration and environment file must be provided, before running cli commands. See relevant user variables in [Agent bot configuration](./config.md#agent-bot-configuration-file) and [Agent bot environment](./config.md#agent-bot-environment-file) for more.

## How to use

Usage: `yarn user-bot [command] <arg> -f [fAssetSymbol] -c [configFilePath]`

Available commands:

-   `agents` - list available agents
-   `mint <agentVaultAddress> <amountLots>` - mint the amount of FAssets in lots
-   `mintExecute <collateralReservationId> <transactionHash> <paymentAddress>` - try to execute the minting that was paid but the execution failed
-   `redeem <amountLots>` - trigger redemption
-   `redemptionDefault <amount> <reference> <firstBlock> <lastBlock> <lastTs>` - get paid in collateral if the agent failed to pay redemption underlying
