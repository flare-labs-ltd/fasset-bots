# User command line tool

The name of the user script is currently `user-bot`. (For Vika: The script name may change before release.)

The script doesn't support Metamask or ledgers; all the private keys must be stored on disk. Therefore it is only safe to use for test currencies.

The script has a number of subcomands, which can be listed by calling `user-bot help`.

## Installing the bot

(For Vika: currently you need access to the private repositories `fasset-bots` and `simple-wallet` to do this. But for pubic release the repos will probably become public, so I won't write about this.)

For now, the bot is obtained by cloning the `fasset-bots` git repository.

    git clone git@gitlab.com:flarenetwork/fasset-bots.git

And then you have to install the packages by simply running `yarn` in the `fasset-bots` checkout directory.

NOTE: The command `user-bot` must also be run with `yarn` prefix i.e. `yarn user-bot`.

## Common arguments

The script has one mandatory common argument `-f <fasset_symbol>` (except for subcommand `generateSecrets`). Argument `<fasset_symbol>` can currently have values `FtestXRP` and `FfakeXRP`. It is mandatory for all subcommands except `generateSecrets`.

There are also two optional common arguments:

-   `-c <configFilePath>` - indicates the config file path. If it is omitted, the program uses the path in environment variable `FASSET_USER_CONFIG` and if this is also missing, it uses a built-in file with settings for Coston (`run-config/coston-user.json` in package `fasset-bots-core`).
-   `-s <secretsFilePath>` - indicates the secrets json file path. If it is omitted, the program uses the path in environment variable `FASSET_USER_SECRETS` and if this is also missing, it defaults to `<USERS_HOME>/fasset/secrets.json`.

## Secrets

The script requires a secrets file in json format that holds user addresses and private keys. On Posix systems (Linux and MacOS), the secrets file must have restricted permissions to only be available by the executing user (permission 600).

There is a command to generate secrets json file and seed the secrets file with new keys and passwords:

    user-bot generateSecrets

By default, this prints the secrets to standard output. By adding `-o <filename>` parameter, it saves secrets to a file.

You should move the generated secrets file to its defualt location `<USERS_HOME>/fasset/secrets.json`. If it is anywhere else, you should indicate the path in later invocations with parameter `-s` or environment variable `FASSET_USER_SECRETS`.

Of course, all the accounts in the generated secrets file initially have zero balance. For minting, you have to transfer enough funds to the underlying address. Also, there needs to be some native currency on `user.native_address`, to pay for collateral reservations and for gas.

The secrets file also has a section for keys to external APIs. Those have to be filled by the keys obtained from the respective API providers.

## Minting

The minting is executed with command

    user-bot -f <fasset_symbol> mint [-a <agent_vault_address>] <number_of_lots>

e.g., for minting 3 lots:

    user-bot -f FtestXRP mint 3

or by using a specific agent:

    user-bot -f FtestXRP mint -a 0xe7548D6180007be8e6c2FF87Cad4B592d7E7EBFb 3

This should perform the complete minting process and transfer the minted FAssets to the user's address.

The version without agent address will automatically choose the agent with lowest fee that has the capacity for minting enough lots. The minting will not be automatically split between agents.

For minting against a specific agent, the user must first obtain the list of publicly available agents:

    user-bot -f <fasset_symbol> agents

e.g.

    user-bot -f FtestXRP agents

This prints the list of agent addresses, and for each agent the maximum number of lots they can mint and the fee.

### Completing paid minting

If something goes wrong after the underlyng payment has been made (e.g. loss of network connectivity), the execution of minting can be retried with command

    user-bot -f <fasset_symbol> mintExecute <minting_id>

e.g.

    user-bot -f FtestXRP mintExecute 305

The `minting_id` is printed when the minting is started, but can also be queried with the command

    user-bot -f <fasset_symbol> mintStatus

which prints all the open mintings and their current statuses. (Mintings with the status `PENDING` can be retried; mintngs with status `EXPIRED` are lost since more than 24 hours has passed since the payment.)

## Redeeming

Redemption is performed by the command

    user-bot -f <fasset_symbol> redeem <number_of_lots>

e.g, to redeem 3 lots

    user-bot -f FtestXRP redeem 3

After making requests and burning the fassets, the script ends. It may take an hour or more for the redemption to be completed, i.e. for the underlying funds to arrive to the user address.

### Redemption default

If the agent doesn't pay in time, the user must trigger redemption default to get paid in agent's collateral (equivalent amount plus some bonus). The time for calling default is from an hour or two after redemption started (depends on the underlying network - less for XRP, more for BTC) until 24 hours after minting (when the state connector proofs are no longer available).

First, the user should query the statuses of open redemptions with command

    user-bot -f <fasset_symbol> redemptionStatus

which prints the list of open redemptions with statuses (`PENDING` - the agent still has time to pay, `SUCCESS` - agent has paid, the underlying funds should be on user's account, `DEFAULT` - agent didn't pay, the user can trigger default, and `EXPIRED` - the redemption is lost since neither user nor agent did anything for 24 hours).

For redemptions in status `DEFAULT`, the user should trigger the default payment by executing

    user-bot -f <fasset_symbol> redemptionDefault <redemption_id>

e.g.

    user-bot -f FtestXRP redemptionDefault 208

## Collateral pool providers

To become a collateral pool provider, execute

    user-bot -f <fasset_symbol> enterPool <pool_id> <amount>

where `pool_id` is the pool token symbol and `amount` is the amount in CFLR to put in the pool.

e.g.

    user-bot -f FtestXRP enterPool TXRP-AGENTBOB-2 1000

To exit the pool, which transfers collateral and the proportional amouint of pool FAsset fees to the user's account, execute

    user-bot -f <fasset_symbol> exitPool <pool_id> <amount>|all

e.g.

    user-bot -f FtestXRP exitPool TXRP-AGENTBOB-2 500

or

    user-bot -f FtestXRP exitPool TXRP-AGENTBOB-2 all

To list all the pool holdings by the user for some FAsset type execute

    user-bot -f <fasset_symbol> poolHoldings

e.g.

    user-bot -f FtestXRP poolHoldings

To list all teh available pools for some FAsset type, together with statistics, execute

    user-bot -f <fasset_symbol> pools

e.g.

    user-bot -f FtestXRP pools
