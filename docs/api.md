# REST APIs for Agent bot

## Setup if you are setting up fasset-bots from the beginning
In the root of the repository create .env file and paste the following lines:

```env
## Path to config file for the agent bot (and other bots) for MYSQL
FASSET_BOT_CONFIG="./packages/fasset-bots-core/run-config/coston-bot-mysql.json"
## If you want to use sqlite (not recommended) uncomment the line below and comment the line above
#FASSET_BOT_CONFIG="./packages/fasset-bots-core/run-config/coston-bot.json"

## Path to secrets file for the agent bot (and other bots)
FASSET_BOT_SECRETS="./secrets.json"

## Enable the following line on Windows to allow reading secrets, since secrets file permission check does not work
# ALLOW_SECRETS_ON_WINDOWS=true

## (Optional) Path to config file for users, instead you can use `-c` parameter
# FASSET_USER_CONFIG="./packages/fasset-bots-core/run-config/coston-user.json"

## (Optional) Path to secrets json file for users, instead you can use `-s` parameter.
FASSET_USER_SECRETS="./secrets.json"

## (Optional) Path to directory, used for storing unexecuted minting. Defaults to `fasset` subdirectory in user's home directory.
# FASSET_USER_DATA_DIR=""
```
Alternatively if you already have .env file, add only the `FASSET_BOT_SQLITE_DB ="./fasset-bots-coston.db"` line to the file (add this only if you use sqlite database). To enable alerts to be sent to backend and be shown on frontend, create a file named `alerts.json` in the root of the repository and paste the following text into it:

```json
{
	"extends": "coston-bot-mysql.json",
	"apiNotifierConfigs": [
    	{
        	"apiKey": "",
        	"apiUrl": "http://localhost:1234/"
    	}
	]
}
```
Change the "extends" value to "coston-bot.json" if you want to use sqlite database. Here the apiUrl is the url where the fasset-bots are deployed. Then, you will have to direct the `FASSET_BOT_CONFIG` to this file so in the `.env` file in the root of the directory replace the line `FASSET_BOT_CONFIG="./packages/fasset-bots-core/run-config/coston-bot.json"` with `FASSET_BOT_CONFIG="./alerts.json"`.
To configure backend, in `fasset-bots/packages/fasset-bots-api` create another `.env` file and paste the following text:
```env
## Path to config file for the agent bot (and other bots) for MYSQL
FASSET_BOT_CONFIG="../fasset-bots-core/run-config/coston-bot-mysql.json"
## If you want to use sqlite (not recommended) uncomment the line below and comment the line above
#FASSET_BOT_CONFIG="../fasset-bots-core/run-config/coston-bot.json"

## Path to secrets file for the agent bot (and other bots)
FASSET_BOT_SECRETS="../../secrets.json"

## Enable the following line on Windows to allow reading secrets, since secrets file permission check does not work
# ALLOW_SECRETS_ON_WINDOWS=true

## (Optional) Path to config file for users, instead you can use `-c` parameter
# FASSET_USER_CONFIG="../fasset-bots-core/run-config/coston-user.json"

## (Optional) Path to secrets json file for users, instead you can use `-s` parameter.
# FASSET_USER_SECRETS=""

## (Optional) Path to directory, used for storing unexecuted minting. Defaults to `fasset` subdirectory in user's home directory.
# FASSET_USER_DATA_DIR=""

## (Optional) Path to database file for the bot.
# FASSET_BOT_SQLITE_DB=""
```

To run fasset-bots backend, run the command `yarn start_agent_api` or `yarn start_agent_api_debug` from the root of repository. In another terminal you can also run your agent-bot with `yarn run-agent` (but only after you generate secrets either on frontend or manually). On the frontend you will be able to config `secrets.json` file. After you have them generated you can run your agent.

## Setting up only fasset-bots backend (if you already have setup the basic fasset-bots)
If you already have setup fasset-bots and you already have a `secrets.json`, then you only need to setup a `.env` file in `fasset-bots/packages/fasset-bots-api`. Create a `.env` file in `fasset-bots/packages/fasset-bots-api` and paste this:
```env
## Path to config file for the agent bot (and other bots) for MYSQL
FASSET_BOT_CONFIG="../fasset-bots-core/run-config/coston-bot-mysql.json"
## If you want to use sqlite (not recommended) uncomment the line below and comment the line above
#FASSET_BOT_CONFIG="../fasset-bots-core/run-config/coston-bot.json"

## Path to secrets file for the agent bot (and other bots)
FASSET_BOT_SECRETS="../../secrets.json"

## Enable the following line on Windows to allow reading secrets, since secrets file permission check does not work
# ALLOW_SECRETS_ON_WINDOWS=true

## (Optional) Path to config file for users, instead you can use `-c` parameter
# FASSET_USER_CONFIG="../fasset-bots-core/run-config/coston-user.json"

## (Optional) Path to secrets json file for users, instead you can use `-s` parameter.
# FASSET_USER_SECRETS=""

## (Optional) Path to directory, used for storing unexecuted minting. Defaults to `fasset` subdirectory in user's home directory.
# FASSET_USER_DATA_DIR=""

## (Optional) Path to database file for the bot (if you use sqlite).
#FASSET_BOT_SQLITE_DB ="../../fasset-bots-coston.SOME_HEX.db"
```
### If the configured databse is sqlite
Now you will need to edit the `FASSET_BOT_SQLITE_DB`. Here there are 2 options:
- If you already have some agent vaults, i.e. you are not setting up fasset-bots from the beginning, you will probably already have a .db file in the root of the fasset-bots repository. The name of the file will probably be something like `fasset-bots-coston.SOME_HEX_VALUE.db` (SOME_HEX_VALUE will be a hex value). If that is the case then during setup you do not need to have `FASSET_BOT_SQLITE_DB`  in both of the `.env` files. You only need to add this variable in the `.env`, that is in the `fasset-bots/packages/fasset-bots-api` and the value needs to be the same as is the name of your database. So if you have a .db file named `fasset-bots-coston.123.db`, then in the `.env` in `fasset-bots/packages/fasset-bots-api` you need to add `FASSET_BOT_SQLITE_DB ="../../fasset-bots-coston.123.db"`.
- The second option is that if you don’t have any vaults, and do not have a .db file, then you should do the following (this will set the name of the database that will be created when you will create vaults):
In the `.env `in the root of fasset-bots repository, add `FASSET_BOT_SQLITE_DB ="./fasset-bots-coston.db"`. In the `.env` in `fasset-bots/packages/fasset-bots-api`, add `FASSET_BOT_SQLITE_DB ="../../fasset-bots-coston.db"`.
### ENABLING ALERTS
To enable alerts to be sent to backend and be shown on frontend, create a file named `alerts.json` in the root of the repository and paste the following text into it:

```json
{
	"extends": "coston-bot-mysql.json",
	"apiNotifierConfigs": [
    	{
        	"apiKey": "",
        	"apiUrl": "http://localhost:1234/"
    	}
	]
}
```
Change the "extends" value to "coston-bot.json" if you want to use sqlite database. Then, you will have to direct the `FASSET_BOT_CONFIG` to this file so in the `.env` file in the root of the directory replace the line `FASSET_BOT_CONFIG="./packages/fasset-bots-core/run-config/coston-bot.json"` with `FASSET_BOT_CONFIG="./alerts.json"`.
To run fasset-bots backend, run the command `yarn start_agent_api` or `yarn start_agent_api_debug` from the root of repository. In another terminal you can also run your agent-bot with `yarn run-agent`.

### IMPORTANT NOTES:
- If you already have secrets file in fasset-bots repository, you do not have to generate them again. Just make sure you have both `.env` files created and that they are filled as stated above.
- Agent-bot will not work before you have secrets file.
- If you are using sqlite, make sure you have `FASSET_BOT_SQLITE_DB` variable in both `.env` files and that the variable is set correctly as stated above.
- If you are not on a linux based system, some features might not work correctly (such as showing age offline/online, as we read the processes on the device the backend is running on).
- Make sure that in `.env` in fasset-bots root you have `FASSET_BOT_SECRETS="./secrets.json"` and in `.env` in `fasset-bots/packages/fasset-bots-api` you have `FASSET_BOT_SECRETS="../../secrets.json"` as is written above.
- IMPORTANT, IF USING SQLITE!!!: If you already have some agent vaults, i.e. you are not setting up fasset-bots from the beginning, you will probably already have a .db file in the root of the fasset-bots repository. The name of the file will probably be something like `fasset-bots-coston.SOME_HEX_VALUE.db`. If that is the case then during setup you do not need to have `FASSET_BOT_SQLITE_DB`  in both of the `.env` files. You only need to add this variable in the `.env`, that is in the `fasset-bots/packages/fasset-bots-api` and the value needs to be the same as is the name of your database. So if you have a .db file named `fasset-bots-coston.123.db`, then in the .env in `fasset-bots/packages/fasset-bots-api` you need to add `FASSET_BOT_SQLITE_DB ="../../fasset-bots-coston.123.db"`.
- If you want your frontend to receive alerts, don’t forget to setup agent bot alerts as stated above.
- Variable `FASSET_BOT_SQLITE_DB` is only needed if you use sqlite database.


## Run

Note: before running agent bot must be set up.

Run with `yarn start_agent_api` or `yarn start_agent_api_debug`.

Swagger is locally running at http://localhost:1234/api-doc.

## Setting up agent UI
Clone the Agent UI repo.
Go to master branch. In “src” directory create .env file and paste needed enviromental variables:
```env
##The walletconnect project ID is available in flare fasset telegram support group
WALLETCONNECT_PROJECT_ID=PROJECT_ID
#This is the default url that the backend will be available on.
API_URL=http://localhost:1234/api
```
Here the API_URL is the URL where the fasset-bots are deployed. To run the app, move into the “src” folder na run:
`Run npm install`
`Run npm run dev`
Open http://localhost:3000 with your browser to see the result

<!-- Configuration and environment file must be provided, before running APIs. See [Agent bot configuration](./config.md#agent-bot-configuration-file) and [Agent bot environment](./config.md#env) for more.

Api key and its hash can be generated via command `yarn key-gen createApiKeyAndHash`. See more [here](./cli.md#cli-key);

To run service use `yarn agent_api_start`. Swagger is locally running at http://localhost:3306/api-doc.

## Response fields

All responses include the following fields:

| Field          | Type   | Description                                                         |
| -------------- | ------ | ------------------------------------------------------------------- |
| `status`       | string | "OK", "ERROR"                                                       |
| `data`         |        | Contains the requested data (depending on the request).             |
| `errorMessage` | string | Contains the description of the error. Undefined if status is "OK". |

## Agent bot APIs

Agent bot web service routes are documented using the Swagger interface at the `/api-doc` route. They are separated in following groups:

-   AGENT:

    -   GET `/api/agent/create/{fAssetSymbol}/{poolTokenSuffix}`: Given parameters `fAssetSymbol` and `poolTokenSuffix`, returns JSON response containing essential agent data:

    | Field                        | Type   | Description                   |
    | ---------------------------- | ------ | ----------------------------- |
    | `vaultAddress`               | string | Agent vault address           |
    | `ownerAddress`               | string | Native owner address          |
    | `collateralPoolAddress`      | string | Collateral pool address       |
    | `collateralPoolTokenAddress` | string | Collateral pool token address |
    | `underlyingAddress`          | string | Agent underlying address      |

    -   POST `/api/agent/available/enter/{fAssetSymbol}/{agentVaultAddress}`: Given parameters `fAssetSymbol` and `agentVaultAddress`, returns one of the possible`status` responses, depending on the success of operation.

    -   POST `/api/agent/available/announceExit/{fAssetSymbol}/{agentVaultAddress}`: Given parameters `fAssetSymbol` and `agentVaultAddress`, returns one of the possible`status` responses, depending on the success of operation.

    -   POST `/api/agent/available/exit/{fAssetSymbol}/{agentVaultAddress}`: Given parameters `fAssetSymbol` and `agentVaultAddress`, returns one of the possible`status` responses, depending on the success of operation.

    -   POST `/api/agent/selfClose/{fAssetSymbol}/{agentVaultAddress}/{amountUBA}`: Given parameters `fAssetSymbol`, `agentVaultAddress` and `amountUBA`, returns one of the possible`status` responses, depending on the success of operation.

    -   GET `/api/agent/settings/list/{fAssetSymbol}/{agentVaultAddress}`: Given parameters `fAssetSymbol` and `agentVaultAddress`, returns JSON response containing essential agent settings data:

    | Field                             | Type   | Description                                                                                                                 |
    | --------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
    | `vaultCollateralToken`            | string | Vault collateral address                                                                                                    |
    | `vaultCollateralSymbol`           | string | Vault collateral symbol                                                                                                     |
    | `feeBIPS`                         | string | Minting fee in BIPS                                                                                                         |
    | `poolFeeShareBIPS`                | string | Share of the minting fee that goes to the pool as percentage of the minting fee.                                            |
    | `mintingVaultCollateralRatioBIPS` | string | Collateral ratio at which locked collateral and collateral available for minting is calculated.                             |
    | `mintingPoolCollateralRatioBIPS`  | string | Collateral ratio at which locked collateral and collateral available for minting is calculated.                             |
    | `poolExitCollateralRatioBIPS`     | string | The minimum collateral ratio above which a staker can exit the pool. This is collateral ratio that must be left after exit. |
    | `buyFAssetByAgentFactorBIPS`      | string | The factor set by the agent to multiply the price at which agent buys fassets from pool token holders on self-close exit.   |
    | `poolTopupCollateralRatioBIPS`    | string | The collateral ratio below which it is possible to enter the pool at discounted rate (to prevent liquidation).              |
    | `poolTopupTokenPriceFactorBIPS`   | string | The discount to pool token price when entering and pool collateral ratio is below pool topup collateral ratio.              |

    -   POST `/api/agent/settings/update/{fAssetSymbol}/{agentVaultAddress}/{settingName}/{settingValue}`: Given parameters `fAssetSymbol`, `agentVaultAddress`, `settingName` and `settingValue`, returns one of the possible`status` responses, depending on the success of operation.

-   AGENT VAULT:

    -   POST `/api/agentVault/collateral/deposit/{fAssetSymbol}/{agentVaultAddress}/{amount}`: Given parameters `fAssetSymbol`, `agentVaultAddress` and `amount`, returns one of the possible`status` responses, depending on the success of operation.

    -   POST `/api/agentVault/collateral/withdraw/{fAssetSymbol}/{agentVaultAddress}/{amount}`: Given parameters `fAssetSymbol`, `agentVaultAddress` and `amount`, returns one of the possible`status` responses, depending on the success of operation.

    -   GET `/api/agentVault/collateral/freeBalance{fAssetSymbol}/{agentVaultAddress}`: Given parameters `fAssetSymbol` and `agentVaultAddress`, returns JSON response containing vault collateral free balance:

    | Field     | Type   | Description             |
    | --------- | ------ | ----------------------- |
    | `balance` | string | Collateral free balance |

    -   POST `/api/agentVault/collateral/switch/{fAssetSymbol}/{agentVaultAddress}/{tokenAddress}`: Given parameters `fAssetSymbol`, `agentVaultAddress` and `tokenAddress`, returns one of the possible` status` responses, depending on the success of operation.

    -   POST `/api/agentVault/close/{fAssetSymbol}/{agentVaultAddress}`: Given parameters `fAssetSymbol` and `agentVaultAddress`, returns one of the possible`status` responses, depending on the success of operation.

-   POOL COLLATERAL:

    -   POST `/api/pool/collateral/buy{fAssetSymbol}/{agentVaultAddress}/{amount}`: Given parameters `fAssetSymbol`, `agentVaultAddress` and `amount`, returns one of the possible`status` responses, depending on the success of operation.

    -   GET `/api/pool/collateral/freeBalance{fAssetSymbol}/{agentVaultAddress}`: Given parameters `fAssetSymbol` and `agentVaultAddress`, returns JSON response containing pool collateral free balance:

    | Field     | Type   | Description       |
    | --------- | ------ | ----------------- |
    | `balance` | string | Pool free balance |

    -   POST `/api/pool/fee/withdraw/{fAssetSymbol}/{agentVaultAddress}/{amount}`: Given parameters `fAssetSymbol`, `agentVaultAddress` and `amount`, returns one of the possible`status` responses, depending on the success of operation.

    -   GET `/api/pool/fee/balance/{fAssetSymbol}/{agentVaultAddress}`: Given parameters `fAssetSymbol` and `agentVaultAddress`, returns JSON response containing pool fee balance:

    | Field     | Type   | Description      |
    | --------- | ------ | ---------------- |
    | `balance` | string | Pool fee balance |

    -   POST `/api/pool/delegate/{fAssetSymbol}/{agentVaultAddress}/{recipientAddress}/{bips}`: Given parameters `fAssetSymbol` `agentVaultAddress`, `recipientAddress` and `bips`, returns one of the possible`status` responses, depending on the success of operation.

    -   POST `/api/pool/undelegate/{fAssetSymbol}/{agentVaultAddress}`: Given parameters `fAssetSymbol` and `agentVaultAddress`, returns one of the possible`status` responses, depending on the success of operation.

    -   POST `/api/pool/upgradeWNat/{fAssetSymbol}/{agentVaultAddress}`: Given parameters `fAssetSymbol` and `agentVaultAddress`, returns one of the possible`status` responses, depending on the success of operation.

-   UNDERLYING

    -   GET `/api/underlying/withdraw/announce/{fAssetSymbol}/{agentVaultAddress}`: Given parameters `fAssetSymbol` and `agentVaultAddress`, returns JSON response containing announce underlying data:

    | Field              | Type   | Description       |
    | ------------------ | ------ | ----------------- |
    | `paymentReference` | string | Payment reference |

    -   GET `/api/underlying/withdraw/perform/{fAssetSymbol}/{agentVaultAddress}/{amount}/{destinationAddress}/{paymentReference}`: Given parameters `fAssetSymbol`, `agentVaultAddress`, `amount`, `destinationAddress` and `paymentReference`, returns JSON response containing payment underlying data:

    | Field             | Type   | Description                |
    | ----------------- | ------ | -------------------------- |
    | `transactionHash` | string | Transaction hash reference |

    -   POST `/api/underlying/withdraw/confirm/{fAssetSymbol}/{agentVaultAddress}/{transactionHash}`: Given parameters `fAssetSymbol`, `agentVaultAddress` and `transactionHash`, returns one of the possible`status` responses, depending on the success of operation.

    -   POST `/api/underlying/withdraw/cancel/{fAssetSymbol}/{agentVaultAddress}`: Given parameters `fAssetSymbol` and `agentVaultAddress`, returns one of the possible`status` responses, depending on the success of operation.

    -   GET `/api/underlying/freeBalance/{fAssetSymbol}/{agentVaultAddress}`: Given parameters `fAssetSymbol` and `agentVaultAddress`, returns JSON response containing underlying free balance:

    | Field     | Type   | Description             |
    | --------- | ------ | ----------------------- |
    | `balance` | string | Underlying free balance |

    -   GET `/api/underlying/create/{fAssetSymbol}`: Given parameter `fAssetSymbol`, returns JSON response containing underlying account information:

    | Field        | Type   | Description            |
    | ------------ | ------ | ---------------------- |
    | `address`    | string | Underlying address     |
    | `privateKey` | string | Underlying private key |
