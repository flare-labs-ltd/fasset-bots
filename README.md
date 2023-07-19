# FAsset bots

## FAsset bots

The automated system of [FAsset system](https://gitlab.com/flarenetwork/fasset), which is a protocol for bridging assets from non-smart contract chains to Flare/Songbird. FAsset bots allow setting up several bots (such as agent, challenger, liquidator) and automate actions to events that require quick reactions (such as collateral reservation, minting, redemption, low collateral ratio, price change).

## Actors in FAsset system

* [*Agent*](./docs/actors/agent.md): main player in the FAsset system.
* [*Challenger*](./docs/actors/challenger.md): essential player for maintaining the FAsset system healthy.
* [*Liquidator*](./docs/actors/liquidator.md): player who liquidates bad agents.
* [*SystemKeeper*](./docs/actors/systemKeeper.md): player who makes sure that FAsset system is in order (opens and closes liquidations).
* [*TimeKeeper*](./docs/actors/timeKeeper.md): underlying block maintenance (prove it and update it).

## Configurations

For needed prerequirements, environment variables and other configurations see [here](./docs/config.md).

## How to run Agent bot

In terminal script [`run-agent.ts`](./src/run/run-agent.ts) with command `npx ts-node src/run/run-agent.ts`.

The script will create [AgentBotRunner](./src/actors/AgentBotRunner.ts). The runner will initiate needed context and connect to native network (Flare/Songbird). Then it will constantly check if any active agent stored in persistent state should handle any incoming events (see [Agent](./docs/actors/agent.md)).

In order to create new agent, deposit funds and some do some other manual operations, command line interface is provided [`fasset-bots-cli`](./docs/cli.md). You can access it with opening another terminal and run command `yarn fasset-bots-cli`.

## Command line interface for Agent bots `fasset-bots-cli`

Command line interface can be access by running command `yarn fasset-bots-cli`. For more see [here](./docs/cli.md).

## Helpers

In order to efficiently run Challenger, Liquidation, SystemKeeper some non-persistent state is being tracked with [*TrackedState*](./src/state/TrackedState.ts) and [*TrackedAgentState*](./src/state/TrackedAgentState.ts).
See [here](./docs/trackState.md).

## Test and debug

See [here](./docs/testDebug.md).

## What to be aware of when testing on Coston and testnet XRP

- Run TimeKeeper or manually  run [`proveAndUpdateUnderlyingBlock`](./src/utils/fasset-helpers.ts)  before reserving collateral, before redeeming, ...
- Newly created testnet XRP account should get initial deposit of at least 10 XRP. Otherwise payment to this account will be rejected by tecNO_DST_INSUF_XRP.


### Testnet faucets

- testnet XRP
    - https://yusufsahinhamza.github.io/xrp-testnet-faucet/ - 980 XRP (not limited per day)
    - https://xrpl.org/xrp-testnet-faucet.html - 1000 XRP (not really a faucet, because it generates new address each time)

- Coston
    - https://coston1-faucet.towolabs.com/ - 100 CFLR per day




