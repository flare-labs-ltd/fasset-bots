# REST APIs for Agent bot

## Setup and run

Note: before running agent bot must be set up.

Run with `yarn start_agent_api` or `yarn start_agent_api_debug`.

Swagger is locally running at http://localhost:1234/api-doc.

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
