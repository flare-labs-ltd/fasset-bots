# FAsset Bots changelog

## Version 1.0.0-beta.11
* fixed minor bug that could prevent agent-bots with low CFLR amount (< 2000 CFLR) on work address from starting

## Version 1.0.0-beta.10
* parallelization of operations to speedup redemptions (only enabled for agents that use mysql as database)
* response to agent pings (from trusted ping senders, which have to be enabled in the config)
* some minor bugfixes

## Version 1.0.0-beta.9
* redemption speedups
* notifier sending in background
* cli: generic balance and transfer script (`yarn tokens`)
* cli: `FASSET_DEFAULT` env var can be used instead of `-f` parameter
* use delete account on agent close to completely withdraw collateral
* many small bugs fixed

## Version 1.0.0-beta.8
* first open beta release
