# CLI `fasset-bots-cli`

Usage: `fasset-bots-cli [command] <arg>`

Available commands:

* `create` - create new agent vault
* `deposit <agentVault> <feeBips>` - deposit amount to agent vault from owner's address
* `enter <agentVault> <feeBips> <agentMinCrBips>` - enter available agent's list
* `exit <agentVault>` - exit available agent's list
* `setMinCr <agentVault> <agentMinCrBips>` - set agent's min CR in BIPS
* `withdraw <agentVault> <amount>` - withdraw amount from agent vault to owner's address
* `selfClose <agentVault> <amountUBA>` - self close agent vault with amountUBA of FAssets
* `close <agentVault>` - close agent vault