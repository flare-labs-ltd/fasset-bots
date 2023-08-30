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

Defining the following variables (bound to a DEX `d` and an agent `a`):
- `Vd`: the vault collateral reserve of DEX `d`,
- `Fd`: the f-asset reserve of DEX `d`,
- `δ`: the DEX's fee (for uniswap hardcoded to 0.3%),
- `Fa`: the total f-asset minted/backed by agent `a`,
- `CRc`: current ratio between agent's collateral and the value of backed f-assets,
- `CRt`: target ratio between agent's collateral and the value of backed f-assets,
- `Ra`: reward ratio at which the value of f-asset is priced during liquidation (e.g. 1.1),
- `P`: the f-asset/collateral price on the Flare nework price oracle.

From those vaules we can derive
- `f(v) = Fd v (1 - δ) / (v (1 - δ) + Vd)`: obtained f-assets when swapping `v` collateral for f-asset on a DEX `d`,
- `fm = Fa (CRt - CRc) / (CRt - Ra)`: the max amount of liquidated f-asset,
- `vm = fm Vd / ((1 - δ) (Fd - fm))`: the amount of collateral that when swapped produces `fm` f-assets,
- `vo' = Vd Fd Ra P - 1 / (1 - δ)`: the amount of collateral that maximizes the simplified profit function `M'(v) = f(v) Ra P - v`,
- `vo = min(vo', vm)`: the amount of collateral that maximizes the actual profit function when accounting for the max amount of liquidated f-asset `M(v) = min(f(v), fm) Ra P - v`,
- `profit = f(vo) Ra P - vo`: profit after the arbitrage.

Note that the agent carries two types of collateral:
- vault collateral (some stablecoin or ETH),
- pool collateral (wrapped native).

If agent's vault collateral does not cover the liquidation, the pool collateral is used. This is not yet implemented, but the idea is that when obtained, the pool collateral is swapped back to vault collateral and used to repay the flash loan. The math gets complicated tho and we assume it should not happen often anyway.