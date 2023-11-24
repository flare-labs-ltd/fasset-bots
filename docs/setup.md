# Setting up the agent bot

## Clone and setup repository

>**Note**
>Make sure you have access to both `fasset-bots` and `simple-wallet` gitlab repositories.

In your terminal run the following command:

```console
git clone git@gitlab.com:flarenetwork/fasset-bots.git
```

Then run the following command:

```console
yarn && yarn build
```

## Configure your environment

First, rename `.env.template` into `.env` and uncomment the commented lines.

Then, you need to generate the private keys bound to agent bot operations.
This can be done by using the following command:

```console
yarn user-bot generateSecrets --agent -o secrets.json
```

Now you should have the generated `secrets.json` file in the root folder of the repository.
The relevant field for the agent is the `owner` field, that contains two accounts.
- The Flare account that is used for funding agent vaults and paying gas fees for various smart contract calls. This account should be funded with enough CFLR and USDC, so it can fund the created agent vaults.
- The underlying test-XRP account that is used for paying gas fees on the underlying chain.

## Create an agent vault

To create an agent vault (and output its address), you need to run the following command:

Before creating an agent you need to choose your unique collateral pool token suffix.
It should include upper-case letters, numbers, and dashes (e.g. `ALPHA-1`). Then run

```console
yarn agent-bot create <poolTokenSuffix>
```

This will create an agent vault and output its address. You will need this address for the next step.

To make agent operational you need to fund the agent vault with two types of collateral.
First one is USDC, which can be deposited using below command

```console
yarn agent-bot depositVaultCollateral <agentVaultAddress> <amount> -f FtestXRP
```

Then you need to deposit CFLR, which is done by buying collateral pool tokens. Do this by running
```console
yarn agent-bot buyPoolCollateral <agentVaultAddress> <amount> -f FtestXRP
```

If you deposited enough collateral, you should see that your agent has at least one lot available, by running
```console
yarn user-bot agent <agentVaultAddress> -f FtestXRP
```

In that case you can register your agent as available to the network, by running
```console
yarn user-bot enter <agentVaultAddress> -f FtestXRP
```

Note that your agent owner's Flare account has to be whitelisted, otherwise the above command will fail.

## Run the agent bot

The agent bot takes care of responding to all request made to the agent vaults you have created.
To run the agent bot, you need to run the following command:

```console
yarn ts-node src/run/run-agent.ts
```

## Minting

With agent bot running, users can now mint FtestXRP by running