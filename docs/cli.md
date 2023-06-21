# CLI `fasset-bots-cli`

## Setup

Configuration and environment file must be provided, before running cli commands. See [Configuration and run](./config.md) for more.

## How to use

Usage: `fasset-bots-cli [command] <arg>`

Available commands:

* `create` - create new agent vault
* `depositClass1 <agentVault> <amount>` - deposit class1 collateral to agent vault from owner's address");
* `buyPoolCollateral <agentVault> <amount>` - add pool collateral and agent pool tokens
* `enter <agentVault>` - enter available agent's list
* `exit <agentVault>` - exit available agent's list
* `updateAgentSetting <agentVault> <agentSettingName> <agentSettingValue> `- set agent's settings
* `withdrawClass1 <agentVault> <amount>` - withdraw amount from agent vault to owner's address
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

*   feeBIPS
*   poolFeeShareBIPS
*   mintingClass1CollateralRatioBIPS
*   mintingPoolCollateralRatioBIPS
*   buyFAssetByAgentFactorBIPS
*   poolExitCollateralRatioBIPS
*   poolTopupCollateralRatioBIPS
*   poolTopupTokenPriceFactorBIPS