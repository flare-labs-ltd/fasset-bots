# CLI `agent-bot`

## Setup

Configuration and environment file must be provided, before running cli commands. See [Agent bot configuration](./config.md#agent-bot-configuration-file) and [Agent bot environment](./config.md#agent-bot-environment-file) for more.

## How to use

Usage: `agent-bot [command] <arg>`

Available commands:

* `create` - create new agent vault
* `depositVaultCollateral <agentVault> <amount>` - deposit vault collateral to agent vault from owner's address");
* `buyPoolCollateral <agentVault> <amount>` - add pool collateral and agent pool tokens
* `enter <agentVault>` - enter available agent's list
* `exit <agentVault>` - exit available agent's list
* `updateAgentSetting <agentVault> <agentSettingName> <agentSettingValue> `- set agent's settings
* `withdrawVaultCollateral <agentVault> <amount>` - withdraw amount from agent vault to owner's address
* `withdrawPoolFees <agentVault> <amount>` - withdraw pool fees from pool to owner's address
* `poolFeesBalance <agentVault>` - pool fees balance of agent
* `selfClose <agentVault> <amountUBA>` - self close agent vault with amountUBA of FAssets
* `close <agentVault>` - close agent vault
* `announceUnderlyingWithdrawal <agentVault>` - announce underlying withdrawal and get needed payment reference
* `performUnderlyingWithdrawal <agentVault> <amount> <destinationAddress> <paymentReference>` - perform underlying withdrawal and get needed transaction hash
* `confirmUnderlyingWithdrawal <agentVault> <transactionHash>` - confirm underlying withdrawal with transaction hash
* `cancelUnderlyingWithdrawal <agentVault>` - cancel underlying withdrawal announcement
* `listAgents` - list active agent from persistent state



### Agent's settings:

For more about agent's settings check [AgentSettings.sol](https://gitlab.com/flarenetwork/fasset/-/blob/main/contracts/userInterfaces/data/AgentSettings.sol) in Fasset repository.

*   feeBIPS
*   poolFeeShareBIPS
*   mintingVaultCollateralRatioBIPS
*   mintingPoolCollateralRatioBIPS
*   buyFAssetByAgentFactorBIPS
*   poolExitCollateralRatioBIPS
*   poolTopupCollateralRatioBIPS
*   poolTopupTokenPriceFactorBIPS
