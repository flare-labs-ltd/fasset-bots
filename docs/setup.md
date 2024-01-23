# Setting up the Agent Bot for XRP on Testnet

## Requirements

### Onboarding requirements

To participate in the Testnet beta, you only need a server. The server stores all the wallet private keys and they can be generated during [agent setup](/docs/examples.md) using the command `generate-secrets --agent`. After generating the keys, you must deposit enough collateral (CFLR and USDC or USDT) into the agent's native Coston address `owner.native_address`. Also, ensure that the agent's XRP address `owner.underlying_address` has a minimum of 100 testXRP per vault to initialize the vault underlying address(es).

If you're using Songbird or Flare, it's recommended to have a more secure native address, such as a hardware wallet. While a secure XRP address is also an option, for now it can only be used to extract fees. In addition, when initializing a vault, the initial XRPs must be transferred to the server address before being used.

### Technical requirements

The server or virtual machine requires a minimum of 2 CPUs and 4GB RAM. If the database is on a separate server, the RAM requirement can be lowered to 2GB.

Keep in mind that you need to be running an agent bot all the time to avoid circumstances of lost funds.

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

4. Install dependencies and build the project:

    ```console
    yarn && yarn build
    ```

## Configure your environment

1. Rename `.env.template` into `.env`.

    ```console
    mv .env.template .env
    ```

2. Generate the private keys bound to agent bot operations using the following command:

    ```console
    yarn user-bot generateSecrets --agent --output secrets.json
    ```

   You should have the generated `secrets.json` file in the root folder and now you need to provide the API key values for `native_rpc` and `indexer`. Please ask developer relations engineers for these values from us during the beta testing phase. Leave the `apiKey.xrp_rpc` empty for now.

3. In `secrets.json` the `owner.native_address` field is the Flare account that funds the agent vaults and pays gas fees for various smart contract calls. Fund the native account with enough CFLR and USDC to deposit collateral to agent vaults and pay for transaction gas fees. You can reach out to us, and we can provide these funds.

4. In `secrets.json`, the `owner.underlying_address` field is the underlying test-XRP account that pays the underlying chain's transaction fees. Activate your underlying XRP account by sending at least 100 test-XRP to it. You can use the XRP testnet [faucet](https://yusufsahinhamza.github.io/xrp-testnet-faucet/).

5. Grant read access to `secrets.json` by:

   ```console
   chmod 600 secrets.json
   ```

6. Developer relations engineers need to whitelist your native address. Please provide `owner.native_address` from the `secrets.json` file.

## Create an Agent Vault

1. Choose your unique collateral pool token symbol suffix. It can include upper-case letters, numbers, and dashes (e.g. `ALPHA-1`).

2. To create an agent vault and output its address, you need to run the following command:

    ```console
    yarn agent-bot create <poolTokenSuffix> --fasset FtestXRP
    ```

    It will create an agent vault and output its address. Please save this address for future reference.

    You can see your agent's information using this command:

    ```console
    yarn user-bot agentInfo <agentVaultAddress> -f FtestXRP
    ```

3. To make the agent operational, you need to whitelist it and fund the vault with two types of collateral - vault (USDC) and pool (CFLR). You can ask to whitelist and test tokens, and we will provide them during the beta period. Please send the value in `secrets.json` field `owner.native_address` to the developer relations engineers to receive these assets. You can read about the required collateral from our [concept page](https://docs.flare.network/tech/fassets/collateral/). Please note that the lot size is 1000 XRP during the beta period.

    3.1 The first one is USDC, which you can deposit using the command:

    ```console
    yarn agent-bot depositVaultCollateral <agentVaultAddress> <amount> --fasset FtestXRP
    ```

    Please note that the USDC value is expressed with six decimal places.

    3.2 Then you need to deposit CFLR, which is done by buying collateral pool tokens using this command:

    ```console
    yarn agent-bot buyPoolCollateral <agentVaultAddress> <amount> --fasset FtestXRP
    ```

    Please note that the FLR value is expressed with 18 decimal places.

4. Register your agent as available to the network. Note that your agent owner's Flare account has to be whitelisted. Otherwise, it will fail. Execute this command to register your agent:

    ```console
    yarn agent-bot enter <agentVaultAddress> --fasset FtestXRP
    ```

5. If you deposited enough collateral, you should see that your agent has at least one lot available by running the command.

    ```console
    yarn user-bot agents --fasset FtestXRP
    ```

## Run the agent bot

The agent bot responds to all requests made to the agent vaults you have created. To run the agent bot, you need to run the following command:

```console
yarn run-agent
```

## Minting

1. Start and keep running the agent bot:

    ```console
    yarn run-agent
    ```

2. Fund the user wallet with some CFLR that you can find in the `secrets.json` file under `user.native_address`. You can get the CFLR tokens from the [faucet](https://faucet.towolabs.com/).

3. Fund the user wallet with testnet XRP. You can use the XRP testnet [faucet](https://yusufsahinhamza.github.io/xrp-testnet-faucet/). Please keep in mind that agents take a minting fee.

4. Mint the FtestXRP by running the command:

    ```console
    yarn user-bot mint -a <agentVaultAddress> <amountLots> --fasset FtestXRP --secrets secrets.json
    ```

## Redeeming

1. Start and keep running the agent bot:

    ```console
    yarn run-agent
    ```

2. Fund the user wallet with some CFLR that you can find in the `secrets.json` file under `user.native_address`. You can get the CFLR tokens from the [faucet](https://faucet.towolabs.com/). Please keep in mind that agents take a redeeming fee.

3. Redeem the FtestXRP by running the command:

    ```console
    yarn user-bot redeem <amountLots> -f FtestXRP --secrets secrets.json
    ```
