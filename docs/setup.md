# Setting up the Agent Bot for XRP on Testnet

## Requirements

### Onboarding requirements

To participate in Testnet beta, you only need a server. The server stores all the wallet private keys and they can be generated during [agent setup](/docs/examples.md) using the command `generate-secrets --agent`. After generating the keys, you must deposit enough collateral (CFLR and USDC or USDT) into the agent's native Coston address `owner.native_address`. Also, make sure that the agent's XRP address `owner.underlying_address` has a minimum of 10 testXRP per vault to initialize the vault underlying address(es).

If you're using Songbird or Flare, it's recommended to have a more secure native address, such as a hardware wallet. While a secure XRP address is also an option, for now it can only be used to extract fees. In addition, when initializing a vault, the initial XRPs must first be transferred to the server address before being used.

### Technical requirements

The server or virtual machine requires a minimum of 2 CPUs and 4GB RAM. If the database is on a separate server, the RAM requirement can be lowered to 2GB.

## Clone and setup repository

1. Ensure you can access `fasset-bots` GitLab repository.

2. Clone the repository:

    ```console
    git clone git@gitlab.com:flarenetwork/fasset-bots.git
    ```

3. Switch to `private_beta_v.1.0`:

    ```console
    git checkout private_beta_v.1.0
    ```

4. Install dependancies and build the project:

    ```console
    yarn && yarn build
    ```

## Configure your environment

1. Rename `.env.template` into `.env` and uncomment the commented lines.

    ```console
    mv .env.template .env
    ```

2. Generate the private keys bound to agent bot operations using the following command:

    ```console
    yarn user-bot generateSecrets --agent --output secrets.json
    ```

   You should have the generated `secrets.json` file in the root folder and now you need to provide the API key values for `native_rpc`, `xrp_rpc` and `indexer`.

   The relevant field for the agent is the `owner` field, which contains two accounts:

   - The Flare account funds the agent vaults and pays gas fees for various smart contract calls. Fund this account with enough CFLR and USDC to deposit collateral to agent vaults and pay for transaction gas fees. You can reach out to us, and we can provide these funds.
   - The underlying test-XRP account pays the underlying chain's transaction fees. Activate this account by sending test-XRP to it. You can use the [faucet](https://yusufsahinhamza.github.io/xrp-testnet-faucet/).

3. Grant read access to `secrets.json` by:

   ```console
   chmod 600 secrets.json
   ```

4. We need to whitelist your native address. Please provide `owner.native_address` from the `secrets.json` file.

## Create an Agent Vault

1. Choose your unique collateral pool token suffix.
It can include upper-case letters, numbers, and dashes (e.g. `ALPHA-1`).

2. To create an agent vault and output its address, you need to run the following command:

   ```console
   yarn agent-bot create <poolTokenSuffix> --fasset FtestXRP
   ```

   It will create an agent vault and output its address. Please save this address for future reference.

3. To make the agent operational, you need to fund the vault with two types of collateral.

    3.1 The first one is USDC, which you can deposit using the command:

    ```console
    yarn agent-bot depositVaultCollateral <agentVaultAddress> <amount> --fasset FtestXRP
    ```

    3.2 Then you need to deposit CFLR, which is done by buying collateral pool tokens using this command:

    ```console
    yarn agent-bot buyPoolCollateral <agentVaultAddress> <amount> --fasset FtestXRP
    ```

4. If you deposited enough collateral, you should see that your agent has at least one lot available by running the command:

    ```console
    yarn user-bot agents --fasset FtestXRP
    ```

5. Register your agent as available to the network. Note that your agent owner's Flare account has to be whitelisted. Otherwise, it will fail. Execute this command to register your agent:

    ```console
    yarn agent-bot enter <agentVaultAddress> --fasset FtestXRP
    ```

## Run the agent bot

The agent bot responds to all requests made to the agent vaults you have created. To run the agent bot, you need to run the following command:

```console
yarn ts-node src/run/run-agent.ts
```

## Minting

Before proceeding with minting, you need to fund the user wallet with some CFLR that you can find in the `secrets.json` file under `user.native_address`. You can get the CFLR tokens from the [faucet](https://faucet.towolabs.com/).

With the agent bot running, users can now mint FtestXRP by running:

```console
yarn user-bot mint -a <agentVaultAddress> <amountLots> --fasset FtestXRP --secrets secrets.json
```
