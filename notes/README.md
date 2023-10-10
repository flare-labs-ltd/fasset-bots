# Optimal vault collateral calculation

Here we explain how we calculate the amount of vault collateral that maximizes the arbitrage profit.

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