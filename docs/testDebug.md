# Testing

Tests are divided into two following folders:

-   `test/` These are run by command `test`.
    For example: `yarn test test/<path_to_file>/<file>.ts`. 
    - `e2e/`: end to end tests 
    - `integration/`: integration tests 
    - `unit/`: unit tests

-   `test-hardhat/` These are run by command `testHH`.
    For example: `yarn testHH test-hardhat/<path_to_file>/<file>.ts`. 
    - `fuzzing/`: fuzzing tests (main logic can be found in [`FAssetFuzzing.ts`](../test-hardhat/fuzzing/FAssetFuzzing.ts)) 
    - `integration/`: integration tests 
    - `unit/`: unit tests

## Coverage:

-   Run `yarn cover` for coverage in `test-hardhat/` and `test/`. `html` coverage report is found in `/fasset-bots/coverage/lcov-report/index.html`

# Debugging:

There are two configurations in [`.vscode/launch.json`](.vscode/launch.json) that allow to debug individual test files from folders `test/` and `test-hardhat/`.

-   To debug specific test file in `test/`, modify **Mocha individual test** configuration's `runtimeArgs` to include desired test file.
-   To debug specific test file in `test-hardhat/`, modify **Hardhat individual test** configuration's `runtimeArgs` to include desired test file.
