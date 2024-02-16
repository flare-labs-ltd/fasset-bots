# Setting up the Agent Bot for XRP on Testnet

## Requirements

### Onboarding requirements

To participate in the Testnet beta, you only need a server. The server stores all the wallet private keys, which can be generated during agent setup using the command `generate-secrets --agent`. After generating the keys, you must deposit enough collateral (CFLR and USDC or USDT) into the agent's native Coston address `owner.native_address`. Also, ensure that the agent's XRP address `owner.underlying_address` has a minimum of 100 testXRP per vault to initialize the vault underlying address(es).

If you're using Songbird or Flare, it's recommended to have a more secure native address, such as a hardware wallet. While a secure XRP address is also an option, for now it can only be used to extract fees. In addition, when initializing a vault, the initial XRPs must be transferred to the server address before being used.

### Technical requirements

The server or virtual machine requires a minimum of 2 CPUs and 4GB RAM. If the database is on a separate server, the RAM requirement can be lowered to 2GB.

Remember that you must be running an agent bot all the time to avoid circumstances of lost funds.

## Clone and setup repository

1. Ensure you can access `fasset-bots` GitLab repository.

2. Clone the repository:

    ```console
    git clone git@gitlab.com:flarenetwork/fasset-bots.git
    ```

3. Switch to `private_beta`:

    ```console
    git checkout private_beta
    ```

4. Install dependencies and build the project:

    ```console
    yarn && yarn build
    ```

5. Configure your environment by renaming the `.env.template` to `.env`.

    ```console
    mv .env.template .env
    ```

## Configure access keys

1. Create or use an existing cold address using your wallet of choice that will be your agent's management address. Fund this wallet with some CFLR to pay gas fees for various smart contract calls. You can get the CFLR tokens from the [faucet](https://faucet.towolabs.com/).

2. Generate secrets for your user, agent and other bots

    ```console
    yarn key-gen generateSecrets --user --agent <coldWalletAddress> --other -o secrets.json
    ```

   You should have the generated `secrets.json` file in the root folder and now you need to provide the API key values for `native_rpc` and `indexer`. Please ask developer relations engineers for these values from us during the beta testing phase. Leave the `apiKey.xrp_rpc` empty for now.

3. Grant read access to `secrets.json` by:

   ```console
   chmod 600 secrets.json
   ```

4. In `secrets.json` the `owner.native.address` field is the Flare account that funds the agent vaults and pays gas fees for various smart contract calls. Fund this wallet with some CFLR to pay gas fees for various smart contract calls. You can get the CFLR tokens from the [faucet](https://faucet.towolabs.com/).

5. Developer relations engineers need to whitelist your native address. Please provide the value of `owner.management.address` from the `secrets.json` file.

### Set up your native address

1. Navigate with the block explorer to `AgentOwnerRegistry` smart contract on address `0x746cBEAa5F4CAB057f70e10c2001b3137Ac223B7` and open Write Contract tab.

2. Connect your wallet of choice to the block explorer.

3. Execute the `setWorkAddress` function with the value of `owner.native.address` from the `secrets.json` file.

## Set up and create agent

1. Prepare agent settings file

    ```console
    yarn agent-bot -f FtestXRP create --prepare
    ```

2. Fill `CFLR` value for the `poolTokenSuffix` key. `CFRL` is the native token that is being used as collateral for the agent pool.

3. Choose one of the stable tokens or wrapped ETH in `vaultCollateralFtsoSymbol`. This asset will be used to back up the agent vault collateral.

4. In `secrets.json`, the `owner.testXRP.address` field is the underlying test-XRP account that pays the underlying chain's transaction fees. Activate your underlying XRP account by sending at least 100 test-XRP to it. You can use the XRP testnet [faucet](https://yusufsahinhamza.github.io/xrp-testnet-faucet/).

5. Create the agent specifying the Fasset and agent settings. Please keep in mind that this operation can take a while.

    ```console
    yarn agent-bot -f FtestXRP create tmp.agent-settings.json
    ```

6. To make the agent operational, you need to whitelist it and fund the vault with two types of collateral - vault (USDC) and pool (CFLR). You can ask to whitelist and test tokens, and we will provide them during the beta period. Please send the value in `secrets.json` field `owner.native.address` to the developer relations engineers to receive these assets. You can read about the required collateral from our [concept page](https://docs.flare.network/tech/fassets/collateral/). Please note that the lot size is 1000 XRP during the beta period.

    3.1 The first one is USDC, which you can deposit using the command:

    ```console
    yarn agent-bot depositVaultCollateral <agentVaultAddress> <amount> --fasset FtestXRP
    ```

    Please note that the USDC value is expressed with six decimal places.

    In this example _25000(25K) testUSDC_ is deposited.

    ```console
    $ yarn agent-bot depositVaultCollateral 0x5bc0886D3117507C779BD8c6240eb1C396385223 25000000000 -f FtestXRP
    Initializing environment...
    Environment successfully initialized.
    VAULT COLLATERAL DEPOSIT: Deposit of 25000000000 to agent      0x5bc0886D3117507C779BD8c6240eb1C396385223 was successful.
    ```

    3.2 Then you need to deposit CFLR, which is done by buying collateral pool tokens using this command:

    ```console
    yarn agent-bot buyPoolCollateral <agentVaultAddress> <amount> --fasset FtestXRP
    ```

    Please note that the FLR value is expressed with 18 decimal places.

    In this example _4500 CFLR_ is deposited.

    ```console
    yarn agent-bot buyPoolCollateral 0x5bc0886D3117507C779BD8c6240eb1C396385223 4500000000000000000000 -f FtestXRP
    Initializing environment...
    Environment successfully initialized.
    BUY POOL TOKENS: Agent 0x5bc0886D3117507C779BD8c6240eb1C396385223 bought 4500000000000000000000 of pool tokens successfully.
    ```

7. Register your agent as available to the network. Note that your agent owner's Flare account has to be whitelisted. Otherwise, it will fail. Execute this command to register your agent:

    ```console
    yarn agent-bot enter <agentVaultAddress> --fasset FtestXRP
    ```

    Example:

    ```console
    $ yarn agent-bot enter 0x5bc0886D3117507C779BD8c6240eb1C396385223 -f FtestXRP
    Initializing environment...
    Environment successfully initialized.
    AGENT ENTERED AVAILABLE: Agent 0x5bc0886D3117507C779BD8c6240eb1C396385223 entered available list.
    ```

8. If you deposited enough collateral, you should see that your agent has at least one lot available by running the command.

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

    Example:
    Note: It might take a while to approve payments and get prices.

    ```console
    $ yarn user-bot mint 0x97204bd339e5e33acc7675dea5593f254BD8476C 1 -f FtestXRP
    Initializing environment...
    Environment successfully initialized.
    Reserving collateral...
    Paying on the underlying chain for reservation 18455 to address r9K5mVRUXefhoc4zfJcQMidYtSne5vGpCB...
    Waiting for transaction finalization...
    Waiting for proof of underlying payment transaction 377DA47EABCBA2C23CDC13433074A83C1E248A7894DCA4E7FDE78C074FF4FD6D...
    Executing payment...
    Done
    ```

    From Agent's perspective

    Minting will be automatically recognized via running script [`run-agent.ts`](./src/run/run-agent.ts) and owner will get notified about it.

    ```console
    MINTING STARTED: Minting 18455 started for 0x97204bd339e5e33acc7675dea5593f254BD8476C.
    MINTING EXECUTED: Minting 18455 executed for 0x97204bd339e5e33acc7675dea5593f254BD8476C.
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

    Example:
    note: It might take a while to get payment proofs and prices.

    ```console
    $ yarn user-bot redeem 1 -f FtestXRP
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
