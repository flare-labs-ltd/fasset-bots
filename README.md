# FAsset bots

The [FAsset system](https://docs.flare.network/tech/fassets/) is a protocol that bridges assets from non-smart contract chains to Flare/Songbird. It includes bots that automate actions for various roles (agent, challenger, liquidator) in response to events that need quick reactions, such as collateral reservation, minting, redemption, low collateral ratio, and price changes.

## Actors in FAsset system

- [_Agent_](./docs/actors/agent.md): The main player in the FAsset system.
- [_Challenger_](./docs/actors/challenger.md): Ensures the health of the FAsset system.
- [_Liquidator_](./docs/actors/liquidator.md): Liquidates bad agents.
- [_SystemKeeper_](./docs/actors/systemKeeper.md): Keeps the FAsset system in order by opening and closing liquidations.
- [_TimeKeeper_](./docs/actors/timeKeeper.md): Maintains the underlying block by proving and updating it to prevent the current block from being too outdated, which would otherwise shorten the time for minting or redemption payments.

## Install

Clone this repository `fasset-bots` and enter the `fasset-bots` directory.

    git clone git@gitlab.com:flarenetwork/fasset-bots.git
    cd fassets-bots

If you are an open beta participant, switch to the `open_beta` branch.

    git checkout open_beta

Install `fasset-bots`

    yarn && yarn build

Install mysql and create a user by following this [guide](./docs/mysql.md)

## Setup

#### With Docker (preferred)

1. Create `.env` file containing MySQL username and password for Docker:
	```
	FASSET_DB_USER="fassetbot"
	FASSET_DB_PASSWORD="9owYgVNocTXmRLUGPmcg"
	```
2. Start the setup process by executing this Docker command:
	```
	docker compose --profile setup up
	```
3. Wait until the MySQL and setup services start-up and in another terminal, connect to service to set it up:
	```
	docker compose exec setup bash
	```
4. Continue with agent setup using Official Docs https://docs.flare.network/infra/fassets/deploying-agent/#configure-the-access-keys
Once you are finished with setting up the agent, stop the current docker containers and execute the command:
	```
	docker compose --profile run-agent up
	```

### Manually (not preferred)

#### Agent Bot

Follow [this guide](https://docs.flare.network/infra/fassets/agent/) on how to set up an Agent Bot for XRP on Testnet.

<!-- ### Challenger

### Liquidator

### System keeper

### Time keeper -->

### How to run

#### Agent bot

Run `yarn run-agent`.

The script will create [AgentBotRunner](./packages/fasset-bots-core/src/actors/AgentBotRunner.ts). The runner will initiate needed context and connect to native network. Then it will constantly check if any active agent stored in persistent state should handle any incoming events.

In order to create new agent, deposit funds and do other manual operations, command line interface is provided [`agent-bot`](./docs/cli.md). You can access it with opening another terminal and run command `yarn agent-bot [command]`.

#### Challenger, Liquidator, SystemKeeper, TimeKeeper

Other bots can be run using [ActorBaseRunner](./packages/fasset-bots-core/src/actors/ActorBaseRunner.ts). The runner will initiate needed context and create desired actor via method `async create(config: TrackedStateConfig, address: string, kind: ActorBaseKind)`, where `ActorBaseKind` determines which actor should be created.

Example for such scripts:

- Run `yarn run-challenger` for Challenger.

- Run `yarn run-liquidator` for Liquidator.

- Run `yarn run-systemKeeper` for SystemKeeper.

- Run `yarn run-timeKeeper` for TimeKeeper.

**Helpers**: In order to efficiently run Challenger, Liquidation, SystemKeeper some non-persistent state is being tracked with [_TrackedState_](./packages/fasset-bots-core/src/state/TrackedState.ts) and [_TrackedAgentState_](./packages/fasset-bots-core/src/state/TrackedAgentState.ts).
See [here](./docs/trackState.md).

## Agent bot command line interface

Command line interface is provided for Agent bot, User bot and for key/password generation. For more see [here](./docs/cli.md).

## User bot command line interface

More information about the user bot can be found [here](./docs/user/user-cli.md).

### Examples

- [How to create secrets file for agent?](./docs/examples.md#how-to-create-secrets-file-for-agent)
- [How to encrypt secrets file for agent?](./docs/examples.md#how-to-encrypt-secrets-file-for-agent)
- [How to decrypt secrets file for agent?](./docs/examples.md#how-to-decrypt-secrets-file-for-agent)
- [How to create agent bot and make it available?](./docs/examples.md#how-to-create-agent-bot-and-make-it-available-only-available-agents-can-be-minted-against-to)
- [How to list and change agent settings?](./docs/examples.md#how-to-list-and-change-agent-settings)
- [How to withdraw underlying?](./docs/examples.md#how-to-withdraw-underlying)
- [How to create underlying account?](./docs/examples.md#how-to-create-underlying-account)
- [How to create wallet encryption password?](./docs/examples.md#how-to-create-wallet-encryption-password)
- [How to list available agents?](./docs/examples.md#how-to-list-available-agents)
- [How to mint fassets?](./docs/examples.md#how-to-mint-fassets)
- [How to redeem fassets?](./docs/examples.md#how-to-redeem-fassets)
- [How to list system info?](./docs/examples.md#how-to-list-system-info)
- [How to list agent info?](./docs/examples.md#how-to-list-agent-info)

### REST APIs for Agent bot

Same commands as in [cli `agent-bot`](./docs/cli.md#cli-agent-bot) can be run via REST APIs. For more see [here](./docs/api.md).

<!-- ### Test and Debug

Checkout [this file](./docs/testDebug.md) to learn more about testing & debugging -->

### Logging

Log files are created every hour and can be found in `packages/fasset-bots-core/log/`.

## What to be aware of when testing on Coston and testnet XRP

- Run TimeKeeper or manually run [`proveAndUpdateUnderlyingBlock`](./src/utils/fasset-helpers.ts) before reserving collateral, before redeeming, ...
- Newly created testnet XRP account should get initial deposit of at least 10 XRP. Otherwise payment to this account will be rejected by `tecNO_DST_INSUF_XRP`.

### Testnet Faucets

- Please reach out to our Team Members on Telegram for TestUSDC/TestUSDT tokens

- Testnet XRP
  - [https://faucet.tequ.dev](https://faucet.tequ.dev)
  - [https://test.bithomp.com/faucet](https://test.bithomp.com/faucet)
  - [https://xrpl.org/xrp-testnet-faucet.html](https://xrpl.org/xrp-testnet-faucet.html) - 1000 XRP (not really a faucet, because it generates new address each time)

- Testnet BTC
  - [https://bitcoinfaucet.uo1.net](https://bitcoinfaucet.uo1.net/)
  - [https://coinfaucet.eu/en/btc-testnet](https://coinfaucet.eu/en/btc-testnet/)

- Testnet DOGE
  - [https://dogecoin-faucet.ruan.dev](https://dogecoin-faucet.ruan.dev/)

- Coston
  - [https://faucet.flare.network](https://faucet.flare.network) - 100 CFLR per account per day

### Other Useful Web Clients

- [Testnet XRP Explorer](https://testnet.xrpl.org)
- [Testnet BTC Explorer](https://blockstream.info/testnet)
- [Testnet DOGE Explorer](https://sochain.com/DOGETEST)
- [Coston Explorer](https://coston-explorer.flare.network)
- [Verifier and Indexer Server for testnet XRP](https://testnet-verifier.aflabs.org/verifier/xrp/api-doc#)
- [Verifier and Indexer Server for testnet BTC](https://testnet-verifier.aflabs.org/verifier/btc/api-doc#)
- [Verifier and Indexer Server for testnet DOGE](https://testnet-verifier.aflabs.org/verifier/doge/api-doc#)
- [Attestation Client Public Server connected to Coston](https://attestation-coston.aflabs.net/attestation-client/api-doc)
