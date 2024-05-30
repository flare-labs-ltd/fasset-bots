# FAsset bots

## FAsset bots

The [FAsset system](https://docs.flare.network/tech/fassets/) is a protocol that bridges assets from non-smart contract chains to Flare/Songbird. It includes bots that automate actions for various roles (agent, challenger, liquidator) in response to events that need quick reactions, such as collateral reservation, minting, redemption, low collateral ratio, and price changes.

## Actors in FAsset system

-   [_Agent_](./docs/actors/agent.md): The main player in the FAsset system.
-   [_Challenger_](./docs/actors/challenger.md): Ensures the health of the FAsset system.
-   [_Liquidator_](./docs/actors/liquidator.md): Liquidates bad agents.
-   [_SystemKeeper_](./docs/actors/systemKeeper.md): Keeps the FAsset system in order by opening and closing liquidations.
-   [_TimeKeeper_](./docs/actors/timeKeeper.md): Maintains the underlying block by proving and updating it to prevent the current block from being too outdated, which would otherwise shorten the time for minting or redemption payments.

## Install

Clone this repository `fasset-bots` and enter the `fasset-bots` directory.

    git clone git@gitlab.com:flarenetwork/fasset-bots.git
    cd fassets-bots

If you are beta tester, switch to branch `private_beta_v.1.0`.

    git checkout private_beta_v.1.0

Install `fasset-bots`

    yarn && yarn build

## Setup

### Agent Bot

[Follow this step by step guide to setup an Agent Bot for XRP on Testnet](./docs/setup.md)

Configurations:

- Generate default agent settings file, which will be used to generate new agent. You can also use default one provided in [`agent-settings-config.json`](./run-config/agent-settings-config.json). See [configuration and example](./docs/config.md#agent-default-settings).

- Generate run config file. See [configuration](./docs/config.md#run-config) and [example](./docs/config.md#agent-bot-run-config).

-  Create `.env` file in root folder and add variable `FASSET_BOT_CONFIG`. See [configuration and example](./docs/config.md#env).

- Generate `secrets.json` file in root folder. `secrets.json`. See [configuration](./docs/config.md#secrets-file) and [example](./docs/config.md#agent-bot-secrets-file)

### Challenger

- Generate run config file. See [configuration](./docs/config.md#run-config) and [example](./docs/config.md#challenger-run-config).

- Create `.env` file in root folder and add variable `FASSET_BOT_CONFIG`. See [configuration and example](./docs/config.md#env).

- Generate `secrets.json` file in root folder. See [configuration](./docs/config.md#secrets-file) and [example](./docs/config.md#challenger-bot-secrets-file)

### Liquidator

- Generate run config file. See [configuration](./docs/config.md#run-config) and [example](./docs/config.md#liquidator-and-system-keeper-run-config).

- Create `.env` file in root folder and add variable `FASSET_BOT_CONFIG`. See [configuration and example](./docs/config.md#env).

- Generate `secrets.json` file in root folder. See [configuration](./docs/config.md#secrets-file) and [example](./docs/config.md#challenger-bot-secrets-file)

### System keeper

- Generate run config file. See [configuration](./docs/config.md#run-config) and [example](./docs/config.md#liquidator-and-system-keeper-run-config).

- Create `.env` file in root folder and add variable `FASSET_BOT_CONFIG`. See [configuration and example](./docs/config.md#env).

- Generate `secrets.json` file in root folder. See [configuration](./docs/config.md#secrets-file) and [example](./docs/config.md#challenger-bot-secrets-file)

### Time keeper

- Generate run config file. See [configuration](./docs/config.md#run-config) and [example](./docs/config.md#time-keeper-run-config).

- Create `.env` file in root folder and add variable `FASSET_BOT_CONFIG`. See [configuration and example](./docs/config.md#env).

- Generate `secrets.json` file in root folder. See [configuration](./docs/config.md#secrets-file) and [example](./docs/config.md#challenger-bot-secrets-file)

## How to run

### Agent bot

In terminal script [`run-agent.ts`](./src/run/run-agent.ts) with command `node dist/src/run/run-agent.js`.

The script will create [AgentBotRunner](./src/actors/AgentBotRunner.ts). The runner will initiate needed context and connect to native network (Flare/Songbird). Then it will constantly check if any active agent stored in persistent state should handle any incoming events (see [Agent](./docs/actors/agent.md)).

In order to create new agent, deposit funds and do other manual operations, command line interface is provided [`agent-bot`](./docs/cli.md). You can access it with opening another terminal and run command `yarn agent-bot [command]`.

### Challenger, Liquidator, SystemKeeper and TimeKeeper

Other bots can be run using [ActorBaseRunner](./src/actors/ActorBaseRunner.ts). The runner will initiate needed context and create desired actor via method `async create(config: TrackedStateConfig, address: string, kind: ActorBaseKind)`, where `ActorBaseKind` determines which actor should be created.

Example for such scripts:

-   Challenger [`run-challenger.ts`](./src/run/run-challenger.ts) run by command `node dist/src/run/run-challenger.js`.

-   Liquidator [`run-liquidator.ts`](./src/run/run-liquidator.ts) run by command `node dist/src/run/run-liquidator.js`.

-   System keeper [`run-systemKeeper.ts`](./src/run/run-systemKeeper.ts) run by command `node dist/src/run/run-systemKeeper.js`.

-   Time keeper [`run-timeKeeper.ts`](./src/run/run-timeKeeper.ts) run by command `node dist/src/run/run-timeKeeper.js`.

**Helpers**: In order to efficiently run Challenger, Liquidation, SystemKeeper some non-persistent state is being tracked with [_TrackedState_](./src/state/TrackedState.ts) and [_TrackedAgentState_](./src/state/TrackedAgentState.ts).
See [here](./docs/trackState.md).

### User bot

More information about the user bot can be found [here](./docs/user/user-cli.md).

## Command line interface

Command line interface is provided for Agent bot, User bot and for key/password generation. For more see [here](./docs/cli.md).

## User bot

More information about the user bot can be found [here](./docs/user/user-cli.md).

### Examples

-   [How to create secrets file for agent?](./docs/examples.md#how-to-create-secrets-file-for-agent)
-   [How to create agent bot and make it available?](./docs/examples.md#how-to-create-agent-bot-and-make-it-available-only-available-agents-can-be-minted-against-to)
-   [How to list and change agent settings?](./docs/examples.md#how-to-list-and-change-agent-settings)
-   [How to withdraw underlying?](./docs/examples.md#how-to-withdraw-underlying)
-   [How to create underlying account?](./docs/examples.md#how-to-create-underlying-account)
-   [How to create wallet encryption password?](./docs/examples.md#how-to-create-wallet-encryption-password)
-   [How to list available agents?](./docs/examples.md#how-to-list-available-agents)
-   [How to mint fassets?](./docs/examples.md#how-to-mint-fassets)
-   [How to redeem fassets?](./docs/examples.md#how-to-redeem-fassets)
-   [How to list system info?](./docs/examples.md#how-to-list-system-info)
-   [How to list agent info?](./docs/examples.md#how-to-list-agent-info)

### REST APIs for Agent bot

Same commands as in [cli `agent-bot`](./docs/cli.md#cli-agent-bot) can be run via REST APIs. For more see [here](./docs/api.md).

### Test and Debug

Checkout [this file](./docs/testDebug.md) to learn more about testing & debugging

### Logging

Actions in [AgentBot.ts](./src/actors/AgentBot.ts) and [BotCliCommands.ts](./src/cli/BotCliCommands.ts) are being logged. Log files are created every hour and can be found in `log/log/log-YYYY-MM-DD-HH.log`.

## What to be aware of when testing on Coston and testnet XRP

-   Run TimeKeeper or manually run [`proveAndUpdateUnderlyingBlock`](./src/utils/fasset-helpers.ts) before reserving collateral, before redeeming, ...
-   Newly created testnet XRP account should get initial deposit of at least 10 XRP. Otherwise payment to this account will be rejected by tecNO_DST_INSUF_XRP.

### Testnet faucets

- Please reach out to our Team Members on Telegram for TestUSDC/TestUSDT tokens

-   Testnet XRP
    -   https://yusufsahinhamza.github.io/xrp-testnet-faucet/ - 980 XRP (not limited per day)
    -   https://xrpl.org/xrp-testnet-faucet.html - 1000 XRP (not really a faucet, because it generates new address each time)

-   Coston
    -   https://coston1-faucet.towolabs.com/ - 100 CFLR per account per day


### Other usefull webclients

-   [Verifier and Indexer Server for testnet XRP](https://attestation-coston.aflabs.net/verifier/xrp/api-doc#).
-   [Attestation Client Public Server connected to Coston](https://attestation-coston.aflabs.net/attestation-client/api-doc)
-   [Testnet XRP Explorer](https://testnet.xrpl.org/)
