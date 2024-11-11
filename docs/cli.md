# CLI `agent-bot`

## Setup

Note: before running agent bot must be set up.

## How to use

Usage: `yarn agent-bot [command] <arg> -f [fAssetSymbol]`

Use: `yarn agent-bot help` to list available commands.

Some of the available commands:

-   `validateOwner -f [fAssetSymbol]` - validate the owner's settings and check the owner's addresses' balances
-   `create -f [fAssetSymbol]` - create new agent vault;
-   `depositCollaterals <agentVaultAddress> <lots> -f [fAssetSymbol]` - deposit enough vault and pool collateral to be able to mint given amount of lots;
-   `depositVaultCollateral <agentVaultAddress> <amount> -f [fAssetSymbol]` - deposit vault collateral to agent vault from owner's address";
-   `buyPoolCollateral <agentVaultAddress> <amount> -f [fAssetSymbol]` - add pool collateral and agent pool tokens
-   `enter <agentVaultAddress> -f [fAssetSymbol]` - enter available agent's list
-   `exit <agentVaultAddress> -f [fAssetSymbol]` - begin the process of exiting from available agent's list; exit will later be executed automatically by running agent bot
-   `executeExit <agentVaultAddress> -f [fAssetSymbol]` - execute previously announced exit from available agent's list (only needed in special cases, since running bot does it automatically)
-   `info <agentVaultAddress> -f [fAssetSymbol]` - print agent info
-   `getAgentSettings <agentVaultAddress> -f [fAssetSymbol]` - print agent's settings
-   `updateAgentSetting <agentVaultAddress> <agentSettingName> <agentSettingValue> -f [fAssetSymbol]` - set agent's settings
-   `withdrawVaultCollateral <agentVaultAddress> <amount> -f [fAssetSymbol]` - begin vault collateral withdrawal process from agent's to owner’s address; withdrawal will later be executed automatically by running agent bot
-   `cancelVaultCollateralWithdrawal <agentVaultAddress>`- cancel vault collateral withdrawal process
-   `redeemCollateralPoolTokens <agentVaultAddress> <amount> -f [fAssetSymbol]` - begin collateral pool tokens redemption process from agent's to owner’s address; redemption will later be executed automatically by running agent bot
-   `cancelCollateralPoolTokenRedemption <agentVaultAddress>`- cancel pool tokens redemption process
-   `withdrawPoolFees <agentVaultAddress> <amount> -f [fAssetSymbol]` - withdraw pool fees from pool to owner's address
-   `poolFeesBalance <agentVaultAddress> -f [fAssetSymbol]` - pool fees balance of agent
-   `selfClose <agentVaultAddress> <amount> -f [fAssetSymbol]` - self close agent vault with amount of FAssets
-   `close <agentVaultAddress>` - begin the process of closing agent vault; all the steps required will later be performed automatically by running agent bot
-   `withdrawUnderlying <agentVaultAddress> <amount> <destinationAddress> -f [fAssetSymbol]` - announces and perform underlying withdrawal and get needed transaction hash
-   `cancelUnderlyingWithdrawal <agentVaultAddress> -f [fAssetSymbol]` - cancel underlying withdrawal announcement
-   `listAgents` - list active agent from persistent state
-   `delegatePoolCollateral <agentVaultAddress> <recipient> <share> -f [fAssetSymbol]`- delegate pool collateral, where <share> is decimal number (e.g. 0.3) or percentage (e.g. 30%)
-   `undelegatePoolCollateral <agentVaultAddress> -f [fAssetSymbol]`- undelegate pool collateral
-   `createUnderlyingAccount -f [fAssetSymbol]` - create underlying account
-   `freeVaultCollateral <agentVaultAddress>  -f [fAssetSymbol]` - get free vault collateral
-   `freePoolCollateral <agentVaultAddress>  -f [fAssetSymbol]` - get free pool collateral
-   `freeUnderlying <agentVaultAddress> -f [fAssetSymbol]` - get free underlying balance
-   `switchVaultCollateral <agentVaultAddress>  -f [fAssetSymbol]` - switch vault collateral
-   `upgradeWNat <agentVaultAddress>  -f [fAssetSymbol]` - upgrade WNat contract

### Agent's settings:

-   **feeBIPS**: Minting fee. Normally charged to minters for publicly available agents, but must be set also for self-minting agents to pay part of it to collateral pool. Fee is paid in underlying currency along with backing assets.
-   **poolFeeShareBIPS**: Share of the minting fee that goes to the pool as percentage of the minting fee. This share of fee is minted as f-assets and belongs to the pool.
-   **mintingVaultCollateralRatioBIPS**: Collateral ratio at which we calculate locked collateral and collateral available for minting. Agent may set own value for minting collateral ratio on creation. The value must always be greater than system minimum collateral ratio for vault collateral.
-   **mintingPoolCollateralRatioBIPS**: Collateral ratio at which we calculate locked collateral and collateral available for minting. Agent may set own value for minting collateral ratio on creation. The value must always be greater than system minimum collateral ratio for pool collateral.
-   **buyFAssetByAgentFactorBIPS**: The factor set by the agent to multiply the price at which agent buys f-assets from pool token holders on self-close exit (when requested or the redeemed amount is less than 1 lot).
-   **poolExitCollateralRatioBIPS**: The minimum collateral ratio above which a staker can exit the pool (this is CR that must be left after exit). Must be higher than system minimum collateral ratio for pool collateral.
-   **poolTopupCollateralRatioBIPS**: The CR below which it is possible to enter the pool at discounted rate (to prevent liquidation). Must be higher than system minimum collateral ratio for pool collateral.
-   **poolTopupTokenPriceFactorBIPS**: The discount to pool token price when entering and pool CR is below pool topup CR.
-   **handshakeType**: Handshake type (0 - no verification, 1 - manual verification (minting or redeeming can be rejected), ...)

# CLI `key`

## How to use

Usage: `yarn key-gen [command]`.

Use: `yarn key-gen help` to list available commands.

Some of available commands:

-   `generateSecrets [options]` - generate new secrets file
    - `-c, --config <configFile>`: Config file path. If omitted, env var `FASSET_BOT_CONFIG` or `FASSET_USER_CONFIG` is used. If this is undefined, use embedded config.
    - `-o, --output <outputFile>"`: The output file; if omitted, the secrets are printed to stdout.
    - `--overwrite`: If enabled, the output file can be overwritten; otherwise it is an error if it already exists.
    - `--user`: Generate secrets for user.
    - `--agent <managementAddress>`: Generate secrets for agent; required argument is agent owner's management (cold) address.
    - `--other`: Generate secrets for other bots (challenger, etc.).
-   `createApiKeyAndHash` - create api key and its hash
-   `createWalletEncryptionPassword` - create wallet encryption password
-   `createAccount <chainName>` - create new address/private key pair on the underlying chain

# CLI `user-bot`

## Setup

Note: before running user bot must be set up.

## How to use

Usage: `yarn user-bot [command] <arg> -f [fAssetSymbol]`

Use: `yarn user-bot help` to list available commands.

Some available commands:

-   `info -f [fAssetSymbol]` - info about the system
-   `agents -f [fAssetSymbol]` - list available agents
-   `agentInfo <agentVaultAddress> -f [fAssetSymbol]` - info about an agent"
-   `mint <agentVaultAddress> <numberOfLots> -f [fAssetSymbol]` - mint the number of FAssets in lots
-   `mintExecute -f [fAssetSymbol]` - try to execute the minting that was paid but the execution failed
-   `mintStatus -f [fAssetSymbol]` - list all open mintings
-   `redeem <numberOfLots> -f [fAssetSymbol]` - trigger redemption
-   `redemptionDefault redemptionDefault -f [fAssetSymbol]` - get paid in collateral if the agent failed to pay redemption underlying
-   `redemptionStatus -f [fAssetSymbol]` - list all open redemptions
-   `balance -f [fAssetSymbol]` - get user balances for relevant tokens
-   `pools -f [fAssetSymbol]` - print the list of pools of public agents
-   `poolHoldings -f [fAssetSymbol]` - print the amount of tokens the user owns per pool
-   `enterPool -f [fAssetSymbol]` - enter a collateral pool with specified amount of collateral
-   `exitPool -f [fAssetSymbol]` - exit a collateral pool for specified amount or all pool tokens