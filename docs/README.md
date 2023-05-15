# FAsset bots documentation

## Actors in FAsset system

* [*AgentBot*](./actors/agent.md): main player in the FAsset system.
* [*ChallengerBot*](./actors/challenger.md): essential player for maintaining the FAsset system healthy.
* [*LiquidatorBot*](./actors/liquidator.md): player who liquidates bad agents.
* [*SystemKeeperBot*](./actors/systemKeeper.md): player who makes sure that FAsset system is in order (opens and closes liquidations).

## Configuration and running
[TODO - keep separately in actor files?]
See [here](./config.md).

## Command line interface

See [here](./cli.md).

## Helpers

In order to efficiently run ChallengerBot, LiquidationBot and SystemKeeperBot, some non-persistent state is being tracked with [*TrackedState*](../src/state/TrackedState.ts) and [*TrackedAgentState*](../src/state/TrackedAgentState.ts).
See [here](./trackState.md).

## Test and debug

See [here](./testDebug.md).
