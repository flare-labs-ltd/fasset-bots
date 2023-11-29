# CLI `agent-bot`

## Setup

Configuration and environment file must be provided, before running cli commands. See [Agent bot configuration](./config.md#agent-bot-configuration-file) and [Agent bot environment](./config.md#agent-bot-environment-file) for more.

## How to use

Usage: `yarn agent-bot [command] <arg> -f [fAssetSymbol]`

Available commands:

-   `create <poolTokenSuffix> -f [fAssetSymbol]` - create new agent vault; <poolTokenSuffix> has to be unique for each agent
-   `depositVaultCollateral <agentVault> <amount> -f [fAssetSymbol]` - deposit vault collateral to agent vault from owner's address";
-   `buyPoolCollateral <agentVault> <amount> -f [fAssetSymbol]` - add pool collateral and agent pool tokens
-   `enter <agentVault> -f [fAssetSymbol]` - enter available agent's list
-   `announceExit <agentVault> -f [fAssetSymbol]` - announce exit available agent's list
-   `exit <agentVault> -f [fAssetSymbol]` - exit available agent's list
-   `info <agentVault> -f [fAssetSymbol]` - print agent info
-   `getAgentSettings <agentVault> -f [fAssetSymbol]` - print agent's settings
-   `updateAgentSetting <agentVault> <agentSettingName> <agentSettingValue> -f [fAssetSymbol]` - set agent's settings
-   `withdrawVaultCollateral <agentVault> <amount> -f [fAssetSymbol]` - withdraw amount from agent vault to owner's address
-   `withdrawPoolFees <agentVault> <amount> -f [fAssetSymbol]` - withdraw pool fees from pool to owner's address
-   `poolFeesBalance <agentVault> -f [fAssetSymbol]` - pool fees balance of agent
-   `selfClose <agentVault> <amountUBA> -f [fAssetSymbol]` - self close agent vault with amountUBA of FAssets
-   `close <agentVault>` - close agent vault
-   `announceUnderlyingWithdrawal <agentVault> -f [fAssetSymbol]` - announce underlying withdrawal and get needed payment reference
-   `performUnderlyingWithdrawal <agentVault> <amount> <destinationAddress> <paymentReference> -f [fAssetSymbol]` - perform underlying withdrawal and get needed transaction hash
-   `confirmUnderlyingWithdrawal <agentVault> <transactionHash> -f [fAssetSymbol]` - confirm underlying withdrawal with transaction hash
-   `cancelUnderlyingWithdrawal <agentVault> -f [fAssetSymbol]` - cancel underlying withdrawal announcement
-   `listAgents` - list active agent from persistent state
-   `delegatePoolCollateral <agentVault> <recipient> <bips> -f [fAssetSymbol]`- delegate pool collateral, where <bips> is basis points (1/100 of one percent)
-   `undelegatePoolCollateral <agentVault> -f [fAssetSymbol]`- undelegate pool collateral
-   `createUnderlyingAccount -f [fAssetSymbol]` - create underlying account
-   `freeVaultCollateral <agentVault>  -f [fAssetSymbol]` - get free vault collateral
-   `freePoolCollateral <agentVault>  -f [fAssetSymbol]` - get free pool collateral
-   `freeUnderlying <agentVault> -f [fAssetSymbol]` - get free underlying balance
-   `switchVaultCollateral <agentVault>  -f [fAssetSymbol]` - switch vault collateral
-   `upgradeWNat <agentVault>  -f [fAssetSymbol]` - upgrade WNat contract

### Agent's settings:

-   **feeBIPS**: Minting fee. Normally charged to minters for publicly available agents, but must be set also for self-minting agents to pay part of it to collateral pool. Fee is paid in underlying currency along with backing assets.
-   **poolFeeShareBIPS**: Share of the minting fee that goes to the pool as percentage of the minting fee. This share of fee is minted as f-assets and belongs to the pool.
-   **mintingVaultCollateralRatioBIPS**: Collateral ratio at which we calculate locked collateral and collateral available for minting. Agent may set own value for minting collateral ratio on creation. The value must always be greater than system minimum collateral ratio for vault collateral.
-   **mintingPoolCollateralRatioBIPS**: Collateral ratio at which we calculate locked collateral and collateral available for minting. Agent may set own value for minting collateral ratio on creation. The value must always be greater than system minimum collateral ratio for pool collateral.
-   **buyFAssetByAgentFactorBIPS**: The factor set by the agent to multiply the price at which agent buys f-assets from pool token holders on self-close exit (when requested or the redeemed amount is less than 1 lot).
-   **poolExitCollateralRatioBIPS**: The minimum collateral ratio above which a staker can exit the pool (this is CR that must be left after exit). Must be higher than system minimum collateral ratio for pool collateral.
-   **poolTopupCollateralRatioBIPS**: The CR below which it is possible to enter the pool at discounted rate (to prevent liquidation). Must be higher than system minimum collateral ratio for pool collateral.
-   **poolTopupTokenPriceFactorBIPS**: The discount to pool token price when entering and pool CR is below pool topup CR.

# CLI `key`

## How to use

Usage: `yarn key [command]`

Available commands:

-   `createApiKeyAndHash` - create api key and its hash
-   `createWalletEncryptionPassword` - create wallet encryption password

# CLI `user-bot`

## Setup

Configuration and environment file must be provided, before running cli commands. See relevant user variables in [Agent bot configuration](./config.md#agent-bot-configuration-file) and [Agent bot environment](./config.md#agent-bot-environment-file) for more.

## How to use

Usage: `yarn user-bot [command] <arg> -f [fAssetSymbol] -c [configFilePath]`

Available commands:

-   `agents -f [fAssetSymbol] -c [configFilePath]` - list available agents
-   `mint <agentVaultAddress> <amountLots> -f [fAssetSymbol] -c [configFilePath]` - mint the amount of FAssets in lots
-   `mintExecute <collateralReservationId> <transactionHash> <paymentAddress> -f [fAssetSymbol] -c [configFilePath]` - try to execute the minting that was paid but the execution failed
-   `redeem <amountLots> -f [fAssetSymbol] -c [configFilePath]` - trigger redemption
-   `redemptionDefault <amount> <reference> <firstBlock> <lastBlock> <lastTs> -f [fAssetSymbol] -c [configFilePath]` - get paid in collateral if the agent failed to pay redemption underlying
-   `info [agentVaultAddress] [--agents] -f [fAssetSymbol] -c [configFilePath]` - info about the system (with option `[--agents]` also info about agents is included) or an agent (when `[agentVaultAddress]` is provided)
