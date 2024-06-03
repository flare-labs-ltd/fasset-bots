# Coston beta liquidity pools

First, secure an account with enought `CFLR`, `USDC`, `USDT`, `WETH` and `F_TEXT_XRP` tokens. Then copy `.env.tamplate` into `.env` and fill in the private key of the funded account under `PRIVATE_KEY` field.

> **Note**
> Currently the beta dex contract is not ownable, i.e. allows anyone to add liquidity. When it is made private, the `PRIVATE_KEY` will have to be the same one that is used to deploy the beta dex contract.

## CLI usage

Before proceeding you should wrap your `CFLR` by calling

```bash
yarn cli coston-beta wrap-wnat
```

Currently, the supported liquidity pools are `CFLR/F_TEST_XRP`, `USDC/F_TEST_XRP`, `USDT/F_TEST_XRP`, `WETH/F_TEST_XRP`. To initiate those pools with desired slippage at a certain volume, use the following command:

```bash
yarn cli coston-beta adjust-dex -s 0.1 -v 1000000 -f FTestXRP
```

The above means that when buying `1 FTestXRP` (note you have to add 6 decimals) at the given dex, you incur a slippage of 10%. Note that if you do not have enough `F_TEXT_XRP` the slippage might get capped lower than the one specified. It is very probable that `F_TEST_XRP` will be the most scarce resource, so it is good to have the most explicit control over it. When estimating how large of a slippage one can afford, we can use the following approximate formula:

```
volume = slippage * spent
```

This of course goes for each pool seperately. This means that with the above command our volume of 1 `F_TEST_XRP` represents ~ `10%` of the `F_TEST_XRP` spent by depositing to pool reserves, meaning we have to spend ~ 10 `F_TEST_XRP` at each pool. For each pool this is about 40 `F_TEST_XRP`.

Sometimes you would not like to spend all of your funds, but only a ratio. In that case add `-m` flag which caps the total balance spend by the signer to the given ratio. For example, to spend only 20% of the balance, use the following command:

```bash
yarn cli coston-beta adjust-dex -s 0.1 -v 1000000 -f FTestXRP -m 0.2
```

When wanting to withdraw all liquidity from all pools, run

```bash
yarn cli coston-beta remove-liquidity -f FTestXRP
```

Note that this will leave some minimal liquidity in the pool (as implemented by uniswap-v2 standard).
