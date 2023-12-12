# Test scenarios on Coston and testnet XRP

## Challenger

Preconditions:
- [Properly configure Challenger bot](https://gitlab.com/flarenetwork/fasset-bots/-/blob/master/README.md#challenger).
- [Properly configure Agent bot](https://gitlab.com/flarenetwork/fasset-bots/-/blob/master/README.md#agent-bot).
- Choose Fasset (e.g. `FtestXRP`) and use it in challenger bot script and later in agent's cli commands.
- Choose default challenge strategy (i.e. in challenger's run-config, there should not be variable `challengeStrategy`).

### Challenge illegal payment
Challenger part:
- Select appropriate constants (`CHALLENGER_ADDRESS`, `CHALLENGER_PRIVATE_KEY`, `RUN_CONFIG_PATH` and `fAssetSymbol`) in `src/run/run-challenger.ts`.
- Build project `yarn build`.
- Run challenger script `node dist/src/run/run-challenger.js`.

Agent part:
- Set up agent `yarn agent-bot create <poolTokenSuffix> -f <fAssetSymbol>`.
- Deposit vault collateral to agent `yarn agent-bot depositVaultCollateral <agentVault> 1000000000000000000000 -f <fAssetSymbol>` (e.g. 1000 testUSDT should be enough).
- Check and make note of vault collateral token balance of challenger and agent (e.g. https://coston-explorer.flare.network/address/<challenger.address>, https://coston-explorer.flare.network/address/<agentVault>).
- Get agent's underlying address `yarn agent-bot info <agentVault> -f <fAssetSymbol>`.
- Faucet agent's underlying with 10 testXRP (https://yusufsahinhamza.github.io/xrp-testnet-faucet/).
- Perform illegal payment with 10 testXRP (e.g. make underlying payment from agent's address to owner's address) `yarn utils addTransaction <agentUnderlyingAddress> <ownerUnderlyingAddress> 10000000 -f <fAssetSymbol>`.
- Check if payment was successful https://testnet.xrpl.org/transactions/<transactionHash>.
- Wait for challenger to challenge agent (console.log message will appear after successful challenger, it takes cca 3min, because `DecreasingBalanceProof` is needed).
- Check vault collateral token balance of challenger and agent. There should be a reward for challenger and agent's balance should decrease.

### Challenge double payment:
Challenger part:
- Select appropriate constants (`CHALLENGER_ADDRESS`, `CHALLENGER_PRIVATE_KEY`, `RUN_CONFIG_PATH` and `fAssetSymbol`) in `src/run/run-challenger.ts`.
- Build project `yarn build`.
- Run challenger script `node dist/src/run/run-challenger.js`.

Agent part:
-  Set up agent `yarn agent-bot create <poolTokenSuffix> -f <fAssetSymbol>`.
- Deposit vault collateral to agent `yarn agent-bot depositVaultCollateral <agentVault> 1000000000000000000000 -f <fAssetSymbol>` (e.g. 1000 testUSDT should be enough).
- Check and make note of vault collateral token balance of challenger and agent (e.g. https://coston-explorer.flare.network/address/<challenger.address>, https://coston-explorer.flare.network/address/<agentVault>).
- Get agent's underlying address `yarn agent-bot info <agentVault> -f <fAssetSymbol>`.
- Faucet agent's underlying with 20 testXRP (https://yusufsahinhamza.github.io/xrp-testnet-faucet/)
- Announce underlying payment `yarn agent-bot announceUnderlyingWithdrawal <agentVault> -f <fAssetSymbol>`.
- Perform two consecutive payments with 10 testXRP (e.g. make underlying payments from agent's address to owner's address with received reference from announcement)
`yarn utils addTransaction agentUnderlyingAddress> <ownerUnderlyingAddress> <reference> 10000000 -f <fAssetSymbol>` and
`yarn utils addTransaction agentUnderlyingAddress> <ownerUnderlyingAddress> <reference> 10000000 -f <fAssetSymbol>`
- Check if payments were successful https://testnet.xrpl.org/transactions/<transactionHash1> and https://testnet.xrpl.org/transactions/<transactionHash2>
- Wait for challenger to challenge agent (console.log message will appear after successful challenger, it takes cca 6min, because two `DecreasingBalanceProofs` are needed).
- Check vault collateral token balance of challenger and agent. There should be a reward for challenger and agent's balance should decrease.


###  Challenge negative free balance:
Challenger part:
- Select appropriate constants (`CHALLENGER_ADDRESS`, `CHALLENGER_PRIVATE_KEY`, `RUN_CONFIG_PATH` and `fAssetSymbol`) in `src/run/run-challenger.ts`.
- Build project `yarn build`.
- Run challenger script `node dist/src/run/run-challenger.js`.

Agent part:
- Set up agent `yarn agent-bot create <poolTokenSuffix> -f <fAssetSymbol>`.
- Deposit vault collateral to agent `yarn agent-bot depositVaultCollateral <agentVault> 1000000000000000000000 -f <fAssetSymbol>` (e.g. 1000 testUSDT should be enough).
- Check and make note of vault collateral token balance of challenger and agent (e.g. https://coston-explorer.flare.network/address/<challenger.address>, https://coston-explorer.flare.network/address/<agentVault>).
- Get agent's underlying address `yarn agent-bot info <agentVault> -f <fAssetSymbol>`.
- Faucet agent's underlying with 10 testXRP (https://yusufsahinhamza.github.io/xrp-testnet-faucet/).
- Announce underlying payment `yarn agent-bot announceUnderlyingWithdrawal <agentVault> -f <fAssetSymbol>`.
- Perform payment with 10 testXRP (e.g. make underlying payment from agent's address to owner's address with received reference from announcement) `node utils addTransaction <agentUnderlyingAddress> <ownerUnderlyingAddress> <reference> 10000000 -f <fAssetSymbol>`.
- Check if payment was successful https://testnet.xrpl.org/transactions/<transactionHash>.
- Wait for challenger to challenge agent (console.log message will appear after successful challenger, it takes cca 3min, because `DecreasingBalanceProof` is needed).
- Check vault collateral token balance of challenger and agent. There should be a reward for challenger and agent's balance should decrease.


## Liquidator

Preconditions:
- [Properly configure Liquidator bot](https://gitlab.com/flarenetwork/fasset-bots/-/blob/master/README.md#liquidator).
- [Properly configure Agent bot](https://gitlab.com/flarenetwork/fasset-bots/-/blob/master/README.md#agent-bot).
- Choose Fasset `FfakeXRP` and use it in liquidator bot script and later in agent's cli commands.
- Choose default liquidation strategy (i.e. in liquidator's run-config, there should not be variable `liquidationStrategy`).

###  Liquidate agent due to price changes:
Liquidator part:
- Select appropriate constants (`LIQUIDATOR_ADDRESS`, `LIQUIDATOR_PRIVATE_KEY`, `RUN_CONFIG_PATH` and `fAssetSymbol = 'FfakeXRP'`) in `src/run/run-liquidator.ts`.
- Build project `yarn build`.
- Run liquidator script `node dist/src/run/run-liquidator.js`.
- Optionally mint against available agents with liquidator address to get some Fassets. (Without Fassets liquidator will still change agent's status to LIQUIDATION).

Agent part:
- Wait for Fasset developers to create agent and environment to manipulate with prices. Once prices on `fakeXRP` will be manipulated, `PriceEpochFinalized` event will get triggered and picked up by run liquidator script.

