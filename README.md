# F-Asset Liquidator

This repo contains an implementation of an f-asset liquidator on the [Flare network](https://flare.network/).

> **Note**
> The f-asset bridge is not yet deployed on flare mainnet, it is currently in the testing phase on the flare canary network's testnet coston.

> **Note**
> This repo uses the private gitlab f-asset repo as a node dependancy, so until it is published, build without appropriate ssh key will fail.

> **Warning**
> It may not make sense to use this contract without also running a challenger, as liquidation requires an agent to be challenged. If successful, the challenger has no reason not to also profit from liquidation of the challenged agent (in the same transaction). So, an agent in liquidation may actually be rare or non-existent. Moral: run a challenger.

## Why it's necessary

The f-asset system is a bridge between the Flare network and non-smart contract chains. Its completely decentralized nature makes it reliant on the user ecosystem, especially in overseeing the main actors of the system - agents. Agents are bots that interact with smart contracts on flare to establish a safe bridge that is secured by their collateral. This collateral needs to cover some factor of bridged (f-)asset's value in order to secure against agent failure. When the ratio between agent's collateral and the value of their minted f-assets falls below a certain threshold, the agent is considered undercollateralized and can be liquidated. This means that anyone can exchange their f-assets for agent's collateral at a discount, and keep doing this until agent is again considered sufficiently collateralized. Combining an agent in liquidation with flash loans and DEXs, there arises a possibility of a profitable arbitrage. This repo contains an implementation of such an arbitrage bot.

## Why you should use it

To make profit. All you can lose are gas fees (which on the Flare network are very cheap) as flash loan eliminates the need for any kind of initial investment. Also you are helping the system secure itself against bad debt, which happens if price changes end up making an agent back less than the value of their minted f-assets.

## Assumptions

The two assumptions are:

- A healthy ecosystem of liquidity pool providers that function over the flare network and make it possible to exchange large amounts of agent collateral for f-asset keeping the price aligned with the flare price oracle. Note that Flare uses v2-uniswap inspired dex called [Blaze Swap](https://blazeswap.xyz/).
- Flash loan accessibility of the agent's collateral token. This is meant to be solved soon by making agent's collateral flash-loanable.

## How it works

Every agent in the f-asset system holds two types of collateral - vault and pool. Vault collateral is usually a stablecoin, and pool collateral is always the wrapped native token. The implemented arbitrage strategy using a liquidated agent follows the steps below:
- flash loan an optimal value of vault collateral,
- swap vault collateral for f-asset on a given dex,
- liquidate obtained f-asset and receive vault and pool collateral,
- swap pool collateral on another given dex for vault collateral,
- repay the flash loan (plus possible fee) and take whatever remains.

Note that a dual strategy is possible, starting with pool collateral instead of vault collateral. Two reasons we start with vault collateral are:
- we expect dexes with stablecoin / f-asset pairs to be better liquidated and more stable,
- liquidation usually outputs less pool collateral than vault collateral, so the second swap will consume less fees.

The contract uses Blaze Swap as the default dex, but any v2-uniswap interfaced constant product dex can be used (with the hardcoded 0.3% fee). It also expects a flash lender contract to be [`ERC3156`](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/interfaces/IERC3156FlashLender.sol) and is assumed to have a fixed (or no) fee.

### Calculations

Let `d1` be a vault collateral / f-asset pair dex, `d2` be a pool collateral / vault collateral pair dex, and `a` an agent in liquidation. We define the following variables:
- `Vd1`: the vault collateral reserve of dex `d1`,
- `Fd1`: the f-asset reserve of dex `d1`,
- `Wd2`: the pool collateral reserve of dex `d2`,
- `Vd2`: the vault collateral reserve of dex `d2`,
- `δ1`: dex1's fee (for uniswap hardcoded to 0.3%),
- `δ2`: dex2's fee (for uniswap hardcoded to 0.3%),
- `Fa`: the total f-asset minted/backed by agent `a`,
- `RV`: vault collateral reward ratio for f-asset liquidation,
- `RW`: pool collateral reward ratio for f-asset liquidation,
- `fm`: maximum liquidated f-asset (before getting agent back to safety),
- `PV`: the f-asset price in vault collateral, determined using Flare nework price oracle,
- `PW`: the f-asset price in pool collateral, determined using Flare nework price oracle.

From those vaules we can derive:
- `swap_v_for_f(v) = Fd1 v (1 - δ1) / (v (1 - δ1) + Vd1)`: obtained f-assets when swapping `v` vault collateral for f-asset on dex `d1`,
- `swap_w_for_v(w) = Vd2 w (1 - δ2) / (w (1 - δ2) + Wd2)`: obtained vault collateral when swapping `w` pool collateral for vault collateral on dex `d2`,
- `liquidate_v(f) = f PV RV`: obtained vault collateral when liquidating `f` f-assets,
- `liquidate_w(f) = f PW RW`: obtained pool collateral when liquidating `f` f-assets,
- `profit(v) = liquidate_v(min(swap_v_for_f(v), fm)) + swap_w_for_v(liquidate_w(min(swap_v_for_f(v), fm))) - v`: vault collateral profit of our arbitrage strategy.

Then we determine the vault collateral value `vo` that optimizes `profit` and execute the strategy. The exact calculations for this are inside the `notes/liquidation_arbitrage_calculation.nb` file. Also, there is `notes/simulation.py` file that visualizes how blockchain conditions affect the profit in regards to initially invested vault collateral.

## Dev notes

Clone the repo with
```sh
git clone https://github.com/kuco23/FAsset-Liquidator.git
```
then run
```sh
yarn && yarn compile
```

### Deployment

To deploy the liquidator contract, log the network name inside `.env` file under the key `NETWORK`, then run
```sh
yarn ts-node scripts/deploy.ts
```

### Tests

> **Warning**
> Neither unit nor integration tests will run yet, as unit tests require access to the private `fasset` repository on gitlab, and integration tests require an authorized account's private key, which can change the mocked FTOS's prices on coston.

> **Important**
> Tests use BlazeSwap, which includes a contract that has another contract's bytecode hash hardcoded. If the solidity compiler options differ, BlazeSwap contracts will not compile. In that case use `yarn fix-blazeswap-hash`.

Unit tests are written for Blaze Swap (to describe what is expected from the used liquidity pool) and liquidator contracts. The latter ones are randomized across three sets of ecosystem configurations (in connection to FTSO price data, dex reserves and agent collateral ratios):
- *healthy*: dexes have prices sufficiently aligned with the FTSO and liquidity high enough for low slippage, which makes full agent liquidation the most profitable arbitrage option,
- *semi-healthy*: dex slippage due to low liquidity makes optimal arbitrage profit occur at partial agent liquidation,
- *unhealthy*: dex prices are not aligned with the FTSO prices (specifically, f-asset to vault collateral price is much higher than the one derived from FTSOs), which makes any kind of agent liquidation unprofitable.

Run those tests with
```sh
yarn test test/unit/blazeswap.test.ts test/unit/liquidator.test.ts
```

The above tests mock the f-asset's asset manager contract. For non-mocked contracts, there is an integration test, using forked coston network. It requires a private key corresponding to address `0x88278079a62db08fEb125f270102651BbE8F9984` to be logged into `.env` file under the key `DEPLOYER_PRIVATE_KEY`. With this, first fork the network in one terminal
```sh
yarn fork
```
then run the test in another terminal
```sh
yarn test test/integration/liquidator.test.ts
```

## TODO
- [ ] add UBA and Wei to Liquidator contract variables,
- [ ] CLI for deployment (parameter is the used network).