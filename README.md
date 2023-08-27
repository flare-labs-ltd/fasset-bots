# FAsset bots

## FAsset bots

The automated system of [FAsset system](https://gitlab.com/flarenetwork/fasset), which is a protocol for bridging assets from non-smart contract chains to Flare/Songbird. FAsset bots allow setting up several bots (such as agent, challenger, liquidator) and automate actions to events that require quick reactions (such as collateral reservation, minting, redemption, low collateral ratio, price change).

## Actors in FAsset system

* [*Agent*](./docs/actors/agent.md): main player in the FAsset system.
* [*Challenger*](./docs/actors/challenger.md): essential player for maintaining the FAsset system healthy.
* [*Liquidator*](./docs/actors/liquidator.md): player who liquidates bad agents.
* [*SystemKeeper*](./docs/actors/systemKeeper.md): player who makes sure that FAsset system is in order (opens and closes liquidations).
* [*TimeKeeper*](./docs/actors/timeKeeper.md): underlying block maintenance (prove it and update it).

## Install

Clone project. Install `fasset` and `simple-wallet` in the same directory as `fasset-bots`.

Run `yarn` and `yarn build`.

## Configurations

For needed prerequirements, environment variables and other configurations see [here](./docs/config.md).

## How to run Agent bot

In terminal script [`run-agent.ts`](./src/run/run-agent.ts) with command `node dist/src/run/run-agent.js`. (Make sure you ran `yarn build` before).

The script will create [AgentBotRunner](./src/actors/AgentBotRunner.ts). The runner will initiate needed context and connect to native network (Flare/Songbird). Then it will constantly check if any active agent stored in persistent state should handle any incoming events (see [Agent](./docs/actors/agent.md)).

In order to create new agent, deposit funds and some do some other manual operations, command line interface is provided [`agent-bot`](./docs/cli.md). You can access it with opening another terminal and run command `yarn agent-bot`.

## Command line interface for Agent bots `agent-bot`

Command line interface can be access by running command `yarn agent-bot`. For more see [here](./docs/cli.md).

## How to run other bots (Challenger, Liquidator and SystemKeeper)

Other bots can be run using [ActorBaseRunner](./src/actors/ActorBaseRunner.ts). The runner will initiate needed context and create desired actor via method `async create(config: TrackedStateConfig, address: string, kind: ActorBaseKind)`, where `ActorBaseKind` determines which actor should be created.

Example for such script using actor base runner for Challenger can be found in [`run-challenger.ts`](./src/run/run-challenger.ts) and run by command `node dist/src/run/run-challenger.js`. (Make sure you ran `yarn build` before).

## Helpers

In order to efficiently run Challenger, Liquidation, SystemKeeper some non-persistent state is being tracked with [*TrackedState*](./src/state/TrackedState.ts) and [*TrackedAgentState*](./src/state/TrackedAgentState.ts).
See [here](./docs/trackState.md).

## Test and debug

See [here](./docs/testDebug.md).

## Logging

Actions in [AgentBot.ts](./src/actors/AgentBot.ts) and [BotCliCommands.ts](./src/cli/BotCliCommands.ts) are being logged. Log files are created every hour and can be found in `log/log/log-YYYY-MM-DD-HH.log`.

## What to be aware of when testing on Coston and testnet XRP

- Run TimeKeeper or manually  run [`proveAndUpdateUnderlyingBlock`](./src/utils/fasset-helpers.ts) before reserving collateral, before redeeming, ...
- Newly created testnet XRP account should get initial deposit of at least 10 XRP. Otherwise payment to this account will be rejected by tecNO_DST_INSUF_XRP.

### Testnet faucets

- testnet XRP
    - https://yusufsahinhamza.github.io/xrp-testnet-faucet/ - 980 XRP (not limited per day)
    - https://xrpl.org/xrp-testnet-faucet.html - 1000 XRP (not really a faucet, because it generates new address each time)

- Coston
    - https://coston1-faucet.towolabs.com/ - 100 CFLR per day

### Other usefull webclients

- [Verifier and Indexer Server for testnet XRP](https://attestation-coston.aflabs.net/verifier/xrp/api-doc#) (ApiKey to access it can found in .env file - ask Urška or Iztok).
- [Attestation Client Public Server connected to Coston](https://attestation-coston.aflabs.net/attestation-client/api-doc)
- [Testnet XRP Explorer](https://testnet.xrpl.org/)

### Simple wallet

Payments in bots are performed via [simple-wallet](https://gitlab.com/flarenetwork/simple-wallet).


