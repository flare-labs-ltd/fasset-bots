# FAsset bots

## Testing

Tests are divided into two folowing folders:

* `test/` These are run by command `test`.
For example: `yarn test test/**/**.ts`.

* `test-hardhat/` These are run by command `testhh`.
For example: `yarn testhh test-hardhat/**/**.ts`.

### Debugging:
There are two configurations in `.vscode/launch.json` that allow to debug individual test files from folders `test/` and `test-hardhat/`.

*  To debug specific test file in `test/`, modify **Mocha individual test** configuration's `runtimeArgs` to include desired test file.
*  To debug specific test file in `test-hardhat/`, modify **Hardhat individual test** configuration's `runtimeArgs` to include desired test file.


### Coverage:

* Run `testhh:coverage` for coverage in `test-hardhat/`. `html` coverage report is found in `/fasset-bots/coverage/index.html`
* Run `test:coverage` for coverage in `test/`. `html` coverage report is found in `/fasset-bots/coverage/index.html`
* Run `cover` for coverage in `test-hardhat/` and `test/unit/{ALGO,XRP}/`. `html` coverage report is found in `/fasset-bots/coverage/lcov-report/index.html`

## CLI `fasset-bots-cli`

Usage: `fasset-bots-cli [command] <arg>`

Available commands: 

* `create` - create new agent vault
* `deposit <amount> <agentVault>` - deposit amount to agent vault from owner's address
* `enter <agentVault> <feeBIPS> <agentMinCRBIPS>` - enter available agent's list
* `exit <agentVault>` - exit available agent's list 

