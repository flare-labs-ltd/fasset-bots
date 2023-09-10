# F-Asset Liquidator

This repo contains an implementation of an f-asset liquidator on the [Flare network](https://flare.network/).

>**Note**: The f-asset bridge is not yet deployed on flare mainnet, it is currently in the testing phase on the flare canary network's testnet coston.

## Why it's necessary

The f-asset system is a bridge between the Flare network and non-smart contract chains. Its completely decentralized nature makes it reliant on the user ecosystem, especially in overseeing the main actors of the system - agents. Agents are bots that interact with smart contracts on flare to establish a safe bridge that is secured by their collateral. This collateral needs to cover some factor of bridged (f-)asset's value in order to secure against agent failure. When the ratio between agent's collateral and the value of their minted f-assets falls below a certain threshold, the agent is considered undercollateralized and can be liquidated. This means that anyone can exchange their f-assets for agent's collateral at a discount, and keep doing this until agent is again considered sufficiently collateralized. Combining an agent in liquidation with flash loans and DEXs, there arises a possibility of a profitable arbitrage. This repo contains an implementation of such an arbitrage bot.

## Why you should use it

To make profit. All you can lose are gas fees (which on the Flare network are very cheap) as the contract will revert if it does not make any profit. Also you are helping the system secure itself against bad debt, which happens if price changes end up making an agent back less than the value of their minted f-assets.

## Assumptions

The main assumption is the healthy ecosystem of liquidity pool providers that function over the flare network and make it possible to exchange large amounts of agent collateral for f-asset keeping the price aligned with the flare price oracle. Note that Flare uses v2-uniswap inspired dex called [blazeswap](https://blazeswap.xyz/).

Another requirement is the f-asset flash loan accessibility. This will be solved soon by making agent's collateral flash-loanable.

## How it works

Every agent in the f-asset system holds two types of collatera - vault and pool. Vault collateral is usually a stablecoin, and pool collateral is always the wrapped native token. The implemented arbitrage strategy using a liquidated agent follows the steps below:
- flash loan an optimal value of vault collateral,
- swap vault collateral for f-asset on a given dex,
- liquidate obtained f-asset and receive vault and pool collateral,
- swap pool collateral on another given dex for vault collateral,
- repay the flash loan (plus possible fee) and take whatever remains.

Note that a dual strategy is possible, starting with pool collateral instead of vault collateral. Two reasons we start with vault collateral are:
- we expect dexes with stablecoin/f-asset pairs to be better liquidated and more stable,
- liquidation usually outputs less pool collateral than vault collateral, so the second swap will consume less fees.

The contract uses Blazeswap as the default dex, but any v2-uniswap interfaced constant product dex can be used. Also note that flash loan is assumed to have a fixed (or no) fee.

### Cauculations

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
- `fd1(v) = Fd1 v (1 - δ1) / (v (1 - δ1) + Vd1)`: obtained f-assets when swapping `v` vault collateral for f-asset on a DEX `d1`,
- `vd2(w) = Vd2 w (1 - δ2) / (w (1 - δ2) + Wd2)`: obtained vault collateral when swapping `w` pool collateral for vault collateral on a DEX `d2`,
- `vm = fm Vd1 / ((1 - δ1) (Fd1 - fm))`: the amount of vault collateral that when swapped on dex `d1` produces `fm` f-assets,
- `profit(v) = L(min(fd1(v), fm)) - v`, where `L(f) = f PV RV + vd2(f PW RW)`: vault collateral profit of our arbitrage strategy.

Then we determine the vault collateral value `vo` that optimizes `profit` and execute the strategy. The exact calculations for this are inside the `scripts/liquidation_arbitrage_calculation.nb` file.