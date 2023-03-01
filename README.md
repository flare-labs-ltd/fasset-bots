# FAsset bots

## Testing

Tests are divided into two following folders:

* `test/` These are run by command `test`.
For example: `yarn test test/**/**.ts`.

* `test-hardhat/` These are run by command `testHH`.
For example: `yarn testHH test-hardhat/**/**.ts`.

### Debugging:
There are two configurations in `.vscode/launch.json` that allow to debug individual test files from folders `test/` and `test-hardhat/`.

*  To debug specific test file in `test/`, modify **Mocha individual test** configuration's `runtimeArgs` to include desired test file.
*  To debug specific test file in `test-hardhat/`, modify **Hardhat individual test** configuration's `runtimeArgs` to include desired test file.


### Coverage:

* Run `testHH:coverage` for coverage in `test-hardhat/`. `html` coverage report is found in `/fasset-bots/coverage/index.html`
* Run `test:coverage` for coverage in `test/`. `html` coverage report is found in `/fasset-bots/coverage/index.html`
* Run `cover` for coverage in `test-hardhat/` and `test/unit/{ALGO,XRP}/`. `html` coverage report is found in `/fasset-bots/coverage/lcov-report/index.html`

## CLI `fasset-bots-cli`

Usage: `fasset-bots-cli [command] <arg>`

Available commands:

* `create` - create new agent vault
* `deposit <agentVault> <feeBips>` - deposit amount to agent vault from owner's address
* `enter <agentVault> <feeBips> <agentMinCrBips>` - enter available agent's list
* `exit <agentVault>` - exit available agent's list
* `setMinCr <agentVault> <agentMinCrBips>` - set agent's min CR in BIPS
* `withdraw <agentVault> <amount>` - withdraw amount from agent vault to owner's address
* `selfClose <agentVault> <amountUBA>` - self close agent vault with amountUBA of FAssets