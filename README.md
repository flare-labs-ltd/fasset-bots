# fAsset-bots

## Testing

Tests are divided into two folowing folders:

* `test/` These are run by command `test`.
For example: `yarn test test/**/**.ts`.

* `test-hardhat/` These are run by command `testhh`.
For example: `yarn testhh test-hardhat/**/**.ts`.

### Coverage:

* Run `testhh:coverage` for coverage in `test-hardhat/`. `html` coverage report is found in `/fasset-bots/coverage/index.html`
* Run `test:coverage` for coverage in `test/`. `html` coverage report is found in `/fasset-bots/coverage/index.html`
* Run `cover` for coverage in `test-hardhat/` and `test/unit/{ALGO,XRP}/`. `html` coverage report is found in `/fasset-bots/coverage/lcov-report/index.html`