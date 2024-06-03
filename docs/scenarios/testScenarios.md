# Test scenarios on Coston and testnet XRP (TODO - needs to be tested!)

## Challenger

Preconditions:
- [Properly configure Challenger bot](https://gitlab.com/flarenetwork/fasset-bots/-/blob/master/README.md#challenger).
- [Properly configure Agent bot](https://gitlab.com/flarenetwork/fasset-bots/-/blob/master/README.md#agent-bot).
- Choose Fasset (e.g. `FTestXRP`) and use it in challenger bot script and later in agent's cli commands.
- Choose default challenge strategy (i.e. in challenger's run-config, there should not be variable `challengeStrategy`).

### Challenge illegal payment
Challenger part:
- Run challenger script `yarn run-challenger`.

Agent part:
- Set up agent `yarn agent-bot create --prepare -f <fAssetSymbol>`, fix file `tmp.agent-settings.json` and then run `yarn agent-bot create tmp.agent-settings.json -f <fAssetSymbol>`.
- Deposit vault collateral to agent `yarn agent-bot depositVaultCollateral <agentVault> 1000 -f <fAssetSymbol>` (e.g. 1000 testUSDT should be enough).
- Check and make note of vault collateral token balance of challenger and agent (e.g. https://coston-explorer.flare.network/address/<challenger.address>, https://coston-explorer.flare.network/address/<agentVault>).
- Get agent's underlying address `yarn agent-bot info <agentVault> -f <fAssetSymbol> --raw`.
- Faucet agent's underlying with testXRP (https://faucet.tequ.dev/).
- Perform illegal payment with 10 testXRP (e.g. make underlying payment from agent's address to owner's address) `yarn utils addTransaction <agentUnderlyingAddress> <ownerUnderlyingAddress> 10 -f <fAssetSymbol>`.
- Check if payment was successful https://testnet.xrpl.org/transactions/<transactionHash>.
- Wait for challenger to challenge agent (console.log message will appear after successful challenger, it takes cca 3min, because `DecreasingBalanceProof` is needed).
- Check vault collateral token balance of challenger and agent. There should be a reward for challenger and agent's balance should decrease.

### Challenge double payment:
Challenger part:
- Run challenger script `yarn run-challenger`.

Agent part:
- Set up agent `yarn agent-bot create --prepare -f <fAssetSymbol>`, fix file `tmp.agent-settings.json` and then run `yarn agent-bot create tmp.agent-settings.json -f <fAssetSymbol>`.
- Deposit vault collateral to agent `yarn agent-bot depositVaultCollateral <agentVault> 1000 -f <fAssetSymbol>` (e.g. 1000 testUSDT should be enough).
- Check and make note of vault collateral token balance of challenger and agent (e.g. https://coston-explorer.flare.network/address/<challenger.address>, https://coston-explorer.flare.network/address/<agentVault>).
- Get agent's underlying address `yarn agent-bot info <agentVault> -f <fAssetSymbol>`.
- Faucet agent's underlying with testXRP (https://faucet.tequ.dev).
- Announce and perform underlying payment of 10 testXRP `yarn agent-bot withdrawUnderlying <agentVault> 10 <ownerUnderlyingAddress> -f <fAssetSymbol>`.
- Perform another payments with 10 testXRP (e.g. make underlying payments from agent's address to owner's address with received reference from `withdrawUnderlying`)
`yarn utils addTransaction <agentUnderlyingAddress> <ownerUnderlyingAddress> 10000000 <reference>  -f <fAssetSymbol>`.
- Check if payments were successful https://testnet.xrpl.org/transactions/<transactionHash1> and https://testnet.xrpl.org/transactions/<transactionHash2>
- Wait for challenger to challenge agent (console.log message will appear after successful challenger, it takes cca 6min, because two `DecreasingBalanceProofs` are needed).
- Check vault collateral token balance of challenger and agent. There should be a reward for challenger and agent's balance should decrease.


###  Challenge negative free balance:
Challenger part:
- Run challenger script `yarn run-challenger`.

Agent part:
- Set up agent `yarn agent-bot create --prepare -f <fAssetSymbol>`, fix file `tmp.agent-settings.json` and then run `yarn agent-bot create tmp.agent-settings.json -f <fAssetSymbol>`.
- Deposit vault collateral to agent `yarn agent-bot depositVaultCollateral <agentVault> 1000 -f <fAssetSymbol>` (e.g. 1000 testUSDT should be enough).
- Check and make note of vault collateral token balance of challenger and agent (e.g. https://coston-explorer.flare.network/address/<challenger.address>, https://coston-explorer.flare.network/address/<agentVault>).
- Get agent's underlying address `yarn agent-bot info <agentVault> -f <fAssetSymbol> --raw`.
- Faucet agent's underlying with testXRP (https://faucet.tequ.dev).
- Withdraw 10 testXRP  `yarn agent-bot withdrawUnderlying <agentVault> 10 <ownerUnderlyingAddress> -f <fAssetSymbol>`.
- Check if payment was successful https://testnet.xrpl.org/transactions/<transactionHash>.
- Wait for challenger to challenge agent (console.log message will appear after successful challenger, it takes cca 3min, because `DecreasingBalanceProof` is needed).
- Check vault collateral token balance of challenger and agent. There should be a reward for challenger and agent's balance should decrease.


## Liquidator

Preconditions:
- [Properly configure Liquidator bot](https://gitlab.com/flarenetwork/fasset-bots/-/blob/master/README.md#liquidator).
- [Properly configure Agent bot](https://gitlab.com/flarenetwork/fasset-bots/-/blob/master/README.md#agent-bot).
- Choose Fasset `FSimCoinX` and use it in liquidator bot script and later in agent's cli commands.
- Choose default liquidation strategy (i.e. in liquidator's run-config, there should not be variable `liquidationStrategy`).

###  Liquidate agent due to price changes:
Liquidator part:
- Select appropriate constants (`LIQUIDATOR_ADDRESS`, `LIQUIDATOR_PRIVATE_KEY`, `FASSET_BOT_CONFIG` and `fAssetSymbol = 'FSimCoinX'`) in `src/run/run-liquidator.ts`.
- Build project `yarn build`.
- Run liquidator script `node dist/src/run/run-liquidator.js`.
- Optionally mint against available agents with liquidator address to get some Fassets. (Without Fassets liquidator will still change agent's status to LIQUIDATION).

Agent part:
- Wait for Fasset developers to create agent and environment to manipulate with prices. Once prices on `SimCoinX` will be manipulated, `PriceEpochFinalized` event will get triggered and picked up by run liquidator script.
