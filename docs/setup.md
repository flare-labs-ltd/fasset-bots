# Setting up the Agent Bot for XRP on Testnet

## Requirements

### Onboarding requirements

To participate in the Testnet beta, you only need a server to run your agent(s) on and to be approved by the Flare team, which will provide you with the necessary access keys and testnet tokens.

### Technical requirements

The server or virtual machine requires a minimum of 2 CPUs and 4GB RAM. If the database is on a separate server, the RAM requirement can be lowered to 2GB.

>**Note**
> You must be running an agent bot all the time to avoid circumstances of lost funds.

## Clone and setup repository

1. Ensure you can access `fasset-bots` GitLab repository.

2. Clone the repository:

    ```console
    git clone git@gitlab.com:flarenetwork/fasset-bots.git
    cd fasset-bots
    ```

3. Switch to `private_beta`:

    ```console
    git checkout private_beta
    ```

4. Install dependencies and build the project:

    ```console
    yarn && yarn build
    ```

5. Configure your environment by copying the `.env.template` to `.env`.

    ```console
    cp .env.template .env
    ```

## Configure access keys

1. Create or use an existing cold wallet that will be your agent's "management address". Fund this wallet with some CFLR, so you can pay the gas fees for various smart contract calls. For this, you can get enough CFLR tokens from the [faucet](https://faucet.towolabs.com/).

2. Generate secrets for your user, agent and other bots

    ```console
    yarn key-gen generateSecrets --user --agent <coldWalletAddress> --other -o secrets.json
    ```

   After running the above command, you should have the generated `secrets.json` file in the root folder. Under the fields `apiKey.native_rpc` and `apiKey.indexer` you should log the API keys that were provided to you by our developer relations team. The `apiKey.xrp_rpc` can be left empty.

3. Grant read access to `secrets.json` by:

   ```console
   chmod 600 secrets.json
   ```

4. In `secrets.json` the `owner.native.address` field is the Flare account that funds the agent vaults and pays gas fees for any agent-related smart contract calls. Provide this address to the developer relations team, so they can fund it with CFLR.

5. The developer relations team needs to whitelist your native address. Please provide the value of `owner.management.address` from the `secrets.json` file and your agent name, description, and icon URL.

### Set up your native address

1. Navigate with the block explorer to `AgentOwnerRegistry` smart contract on address `0x746cBEAa5F4CAB057f70e10c2001b3137Ac223B7` and open Write Contract tab.

2. Connect your wallet of choice to the block explorer.

3. Execute the `setWorkAddress` function with the value of `owner.native.address` from the `secrets.json` file.

## Set up and create agent

1. Prepare agent settings file

    ```console
    yarn agent-bot -f FTestXRP create --prepare
    ```

2. Choose the suffix for your agent's collateral pool and fill in the `poolTokenSuffix` field. The suffix should include only upper-case letters, numbers, and `-` symbols in-between. For example, `MY-ALPHA-AGENT-1`.

3. Choose one of the stable tokens or wrapped ETH in `vaultCollateralFtsoSymbol`. This asset will be used to back up the agent vault collateral. Ask the developer relations team to provide you with the chosen test token.

4. In `secrets.json`, the `owner.testXRP.address` field is the underlying test-XRP account that pays the underlying chain's transaction fees. Activate your underlying XRP account by sending at least 100 test-XRP to it. You can use one of the the XRP testnet faucets:

   * [first option](https://faucet.tequ.dev/)
   * [second option](https://test.bithomp.com/faucet/).

5. Create the agent specifying the Fasset and agent settings. Please keep in mind that this operation can take a while.

    ```console
    yarn agent-bot -f FTestXRP create tmp.agent-settings.json
    ```

6. To make your newly created agent public, it needs to hold enough collateral to mint one lot (currently set to 10) of FXRP. This means its agent vault contract needs to be funded with the two collaterals (CFLR and a stablecoin or wrapped ETH) primarily held by your `owner.native.address`.

    3.1 The first one is the vault collateral, chosen by you previously. It can be deposited using the command:

    ```console
    yarn agent-bot depositVaultCollateral <agentVaultAddress> <amount> --fasset FTestXRP
    ```

    Note that `amount` is specified in the base unit of the chosen collateral. For example, if choosing USDC, it having 6 decimals, means inputting `amount` of 5.1 USDC will be treated as 5100000 in their subunit.

    3.2 Then you need to deposit CFLR, which is done by buying collateral pool tokens using this command:

    ```console
    yarn agent-bot buyPoolCollateral <agentVaultAddress> <amount> --fasset FTestXRP
    ```

    Again note that `amount` is specified in the base unit of CFLR. So, it having 18 decimals, means inputting `amount` of 1000.1 CLFR will be treated as 1000100000000000000000 of the subunit (Wei).

7. Register your agent as available to the network. Note that your agent owner's Flare account has to be whitelisted. Otherwise, it will fail. Execute this command to register your agent:

    ```console
    yarn agent-bot enter <agentVaultAddress> --fasset FTestXRP
    ```

8. If you deposited enough collateral, you should see that your agent has at least one lot available by running the command.

    ```console
    yarn user-bot agents --fasset FTestXRP
    ```

## Run the agent bot

The agent bot responds to all requests made to the agent vaults you have created. To run the agent bot, you need to run the following command:

```console
yarn run-agent
```

We also provide the `systemd` services for running the bot as a daemon. For this, see [here](./docs/systemd/systemd-service.md).

## Minting

1. Fund the user wallet with some CFLR that you can find in the `secrets.json` file under `user.native_address`. You can get the CFLR tokens from the [faucet](https://faucet.towolabs.com/).

2. Fund the user wallet with testnet XRP. You can use the XRP testnet [faucet](https://yusufsahinhamza.github.io/xrp-testnet-faucet/). Please keep in mind that agents take a minting fee.

3. Mint the FTestXRP by running the command:

    ```console
    yarn user-bot mint -a <agentVaultAddress> <amountLots> --fasset FTestXRP --secrets secrets.json
    ```

    Example:
    Note: It might take a while to approve payments and get prices.

    ```console
    $ yarn user-bot mint -a 0x97204bd339e5e33acc7675dea5593f254BD8476C 1 -f FTestXRP
    Initializing environment...
    Environment successfully initialized.
    Reserving collateral...
    Paying on the underlying chain for reservation 18455 to address r9K5mVRUXefhoc4zfJcQMidYtSne5vGpCB...
    Waiting for transaction finalization...
    Waiting for proof of underlying payment transaction 377DA47EABCBA2C23CDC13433074A83C1E248A7894DCA4E7FDE78C074FF4FD6D...
    Executing payment...
    Done
    ```

    From `0x97204bd339e5e33acc7675dea5593f254BD8476C` agent perspective, the minting will be automatically recognized via running script [`run-agent.ts`](./src/run/run-agent.ts) and owner will get notified about it.

    ```console
    MINTING STARTED: Minting 18455 started for 0x97204bd339e5e33acc7675dea5593f254BD8476C.
    MINTING EXECUTED: Minting 18455 executed for 0x97204bd339e5e33acc7675dea5593f254BD8476C.
    ```

4. If minting fails, you can execute the verification again, providing the payment identifier that you got when minting. In this example, it is `18455`.

   ```console
   yarn user-bot mintExecute PAYMENT_ID -f FTestXRP -s secrets.json
   ```

## Redeeming

1. Fund the user wallet with some CFLR that you can find in the `secrets.json` file under `user.native_address`. You can get the CFLR tokens from the [faucet](https://faucet.towolabs.com/). Please keep in mind that a redemption fee is paid out to agents to cover their underlying transaction fees.

2. Redeem the FTestXRP by running the command:

    ```console
    yarn user-bot redeem <amountLots> -f FTestXRP --secrets secrets.json
    ```

    Example:
    note: It might take a while to get payment proofs and prices.

    ```console
    $ yarn user-bot redeem 1 -f FTestXRP
    Initializing environment...
    Environment successfully initialized.
    Asking for redemption of 1 lots
    Triggered 1 payment requests (addresses, block numbers and timestamps are on underlying chain):
    id=17644  to=r3rep182VUoYCCNFqdCyNhbKzS3phQDwU  amount=9900000  agentVault=0x97204bd339e5e33acc7675dea5593f254BD8476C  reference=0x46425052664100020000000000000000000000000000000000000000000044ec  firstBlock=42746846  lastBlock=42747346  lastTimestamp=1699522276
    ```

    From Agent's perspective

    Redemption will be automatically recognized and executed via running script [`run-agent.ts`](./src/run/run-agent.ts) and owner will get notified about it.

    ```console
    REDEMPTION STARTED: Redemption 17644 started for 0x97204bd339e5e33acc7675dea5593f254BD8476C.
    REDEMPTION PAID: Redemption 17644 was paid for 0x97204bd339e5e33acc7675dea5593f254BD8476C.
    REDEMPTION PAYMENT PROOF REQUESTED: Payment proof for redemption 17644 was requested for 0x97204bd339e5e33acc7675dea5593f254BD8476C.
    ```

## Miscellaneous

Discover additional actions and functionalities by exploring further [in this guide](/docs/examples.md) such as listing and changing agent settings, and withdrawing the underlying assets.
