# F-Asset Liquidator

This repo contains an implementation of an f-asset liquidator on the [Flare network](https://flare.network/).

> **Note**
> The f-asset bridge is not yet deployed on flare mainnet, it is currently in the testing phase on the flare canary network's testnet coston.

> **Note**
> This repo uses the private gitlab f-asset repo as a node dependancy, so until it is published, build without appropriate ssh key will fail.

> **Warning**
> It may not make sense to use liquidator contract without also running a challenger, as full-liquidations requires an agent to be challenged. If successful, the challenger has no reason not to also profit from liquidation of the challenged agent (in the same transaction). So, an agent in full-liquidation may actually be rare or non-existent. That's why the repo includes a challenger contract, that runs a challenge and liquidation in the same transaction.

> **Warning**
> To avoid your challenge/liquidation transactions being front-ran, the challenger contract restricts all the functions called to owner-only. This means each challenger bot has to deploy their own challenger contract. The earnings are gathered in that contract, and can be collected by the owner via `withdrawToken` method.

## Why it's necessary

The f-asset system is a bridge between the Flare network and non-smart contract chains. Its completely decentralized nature makes it reliant on the user ecosystem, especially in overseeing the main actors of the system - agents. Agents are bots that interact with smart contracts on flare to establish a safe bridge that is secured by their collateral. This collateral needs to cover some factor of bridged (f-)asset's value in order to secure against agent failure. When the ratio between agent's collateral and the value of their minted f-assets falls below a certain threshold, the agent is considered undercollateralized and can be liquidated. This means that anyone can exchange their f-assets for agent's collateral at a discount, and keep doing this until agent is again considered sufficiently collateralized. Combining an agent in liquidation with flash loans and DEXs, there arises a possibility of a profitable arbitrage. This repo contains an implementation of such an arbitrage bot.

## Why you should use it

To make profit. All you can lose are gas fees (which on the Flare network are very cheap) as flash loan eliminates the need for any kind of initial investment. Also you are helping the system secure itself against bad debt, which happens if price changes end up making an agent back less than the value of their minted f-assets.

## Assumptions

The two assumptions are:

- A healthy ecosystem of liquidity pool providers that function over the flare network and make it possible to exchange large amounts of agent's vault collateral for f-asset, while keeping the price aligned with the flare price oracle. Note that Flare uses v2-uniswap inspired dex called [Blaze Swap](https://blazeswap.xyz/).
- Vault collateral's flash loan accessibility. This is meant to be solved soon by making agent's vault collateral flash-loanable.

## How it works

Every agent in the f-asset system holds two types of collateral - vault and pool. Vault collateral is usually a stablecoin, and pool collateral is always the wrapped native token. The implemented arbitrage strategy using a liquidated agent follows the steps below:
- flash loan an optimal value of vault collateral (for calculations, see `notes/README.md`),
- swap vault collateral for f-asset on a given dex,
- liquidate obtained f-asset and receive vault and pool collateral,
- swap pool collateral on another given dex for vault collateral,
- repay the flash loan (plus possible fee) and take whatever remains.

Note that a dual strategy is possible, starting with pool collateral instead of vault collateral. Two reasons we start with vault collateral are:
- we expect dexes with stablecoin / f-asset pairs to be better liquidated and more stable,
- liquidation usually outputs less pool collateral than vault collateral, so the second swap will consume less fees.

The contract uses Blaze Swap as the default dex, but any v2-uniswap interfaced constant product dex can be used (with the hardcoded 0.3% fee). It also expects a flash lender contract to be [`ERC3156`](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/interfaces/IERC3156FlashLender.sol) and is assumed to have a fixed (or no) fee.

## Dev notes

Clone the repo with
```sh
git clone https://github.com/kuco23/FAsset-Liquidator.git
```
then run
```sh
yarn && yarn compile
```

> **Note**
> To flatten contracts use foundry and `forge flatten` as liquidator includes circular imports, so it can't be flattened by hardhat.

### Deployment

To deploy the liquidator contract, log the network name inside `.env` file under the key `NETWORK`, then run
```sh
yarn ts-node scripts/deploy.ts
```

### Tests

> **Warning**
> Neither unit nor integration tests will run yet, as unit tests require access to the private `fasset` repository on gitlab, and integration tests require an authorized account's private key, which can change the mocked FTOS's prices on coston.

> **Important**
> Tests use BlazeSwap, which includes a contract that has another contract's bytecode hash hardcoded. If the solidity compiler options differ, BlazeSwap contracts will not compile. In that case use `./scripts/replace-blazeswap-hash.sh`.

Unit tests are written for Blaze Swap (to describe what is expected from the used liquidity pool) and liquidator contracts. The latter ones are randomized across three sets of ecosystem configurations (in connection to FTSO price data, dex reserves and agent collateral ratios):
- *healthy*: dexes have prices sufficiently aligned with the FTSO and liquidity high enough for low slippage, which makes full agent liquidation the most profitable arbitrage option,
- *semi-healthy*: dex slippage due to low liquidity makes optimal arbitrage profit occur at partial agent liquidation,
- *unhealthy*: dex prices are not aligned with the FTSO prices (specifically, f-asset to vault collateral price is much higher than the one derived from FTSOs), which makes any kind of agent liquidation unprofitable.

Run those tests with
```sh
yarn test:unit
```

The above tests mock the f-asset's asset manager contract. For non-mocked contracts, there is an integration test, using forked coston network. It requires a private key corresponding to address `0x88278079a62db08fEb125f270102651BbE8F9984` to be logged into `.env` file under the key `DEPLOYER_PRIVATE_KEY`. With this, first fork the network in one terminal
```sh
yarn fork
```
then run the test in another terminal
```sh
yarn test:integration
```

## TODO
- [ ] add UBA and Wei to Liquidator contract variables,
- [ ] CLI for deployment (parameter is the used network),
- [ ] make challenger/liquidator ownable, with method calls restricted to owner.