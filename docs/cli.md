# CLI `fasset-bots-cli`

## Setup

Configuration and environment file must be provided, before running cli commands. See [Configuration and run](./config.md) for more.

## How to use

Usage: `fasset-bots-cli [command] <arg>`

Available commands:

* `create` - create new agent vault
* `deposit <agentVault> <amount>` - deposit class1 collateral to agent vault from owner's address
* `buyPoolCollateral <agentVault> <amount>` - add pool collateral and agent pool tokens
* `enter <agentVault>` - enter available agent's list
* `exit <agentVault>` - exit available agent's list
* `setAgentSetting <agentVault> <agentSettingName> <agentSettingValue>` - set agent's settings
* `withdraw <agentVault> <amount>` - withdraw amount from agent vault to owner's address
* `selfClose <agentVault> <amountUBA>` - self close agent vault with amountUBA of FAssets
* `close <agentVault>` - close agent vault


### Agent's settings:

*   *feeBIPS*
*   *poolFeeShareBIPS*
*   *mintingClass1CollateralRatioBIPS*
*   *mintingPoolCollateralRatioBIPS*
*   *buyFAssetByAgentFactorBIPS*
*   *poolExitCollateralRatioBIPS*
*   *poolTopupCollateralRatioBIPS*
*   *poolTopupTokenPriceFactorBIPS*