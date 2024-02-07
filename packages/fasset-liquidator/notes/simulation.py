from abc import ABC, abstractmethod
from collections import namedtuple
from math import isqrt

# make a plot of liquidation reward dependant on invested vault collateral,
# and color red a point on x-axis of our optimum and green vault collateral
# yielding full liquidation

Ecosystem = namedtuple(
    "Ecosystem",
    [
        # dexes
        "dex1_vault_reserve",
        "dex1_fAsset_reserve",
        "dex2_pool_reserve",
        "dex2_vault_reserve",
        # prices
        "fAsset_vault_price_bips",
        "vault_price_pool_bips",
        # agent
        "liquidation_factor_vault_bips",
        "liquidation_factor_pool_bips",
        "collateral_ratio_vault_bips",
        "collateral_ratio_pool_bips",
        "target_ratio_vault_bips",
        "target_ratio_pool_bips",
        # vault and pool collaterals are derived from crs,
        # prices and mintedUBA
        "mintedUBA",
    ],
)


class ArbitrageStrategy(ABC):
    def __init__(self, ec):
        self.dex1_discrepancy = 0
        self.dex2_discrepancy = 0
        for key, val in zip(ec._fields, ec):
            setattr(self, key, val)

    def _swapDex1(ec, v):
        v_with_fee = 997 * v
        numerator = ec.dex1_fAsset_reserve * v_with_fee
        denominator = 1000 * ec.dex1_vault_reserve + v_with_fee
        return numerator // denominator

    def _swapDex2(ec, w):
        w_with_fee = 997 * w
        numerator = ec.dex2_vault_reserve * w_with_fee
        denominator = 1000 * ec.dex2_pool_reserve + w_with_fee
        return numerator // denominator

    def _swapInDex1(ec, f):
        numerator = 1000 * ec.dex1_vault_reserve * f
        denominator = 997 * (ec.dex1_fAsset_reserve - f)
        return numerator // denominator + 1

    def _liquidateVault(ec, f):
        return (
            f
            * ec.liquidation_factor_vault_bips
            * ec.fAsset_vault_price_bips
            // 10_000**2
        )

    def _liquidatePool(ec, f):
        return (
            f
            * ec.liquidation_factor_pool_bips
            * ec.vault_price_pool_bips
            // 10_000**2
        )

    def maxLiquidatedFAssetUBA(ec):
        max_liquidated_fAsset_vault = (
            ec.mintedUBA
            * (ec.target_ratio_vault_bips - ec.collateral_ratio_vault_bips)
            // (ec.target_ratio_vault_bips - ec.liquidation_factor_vault_bips)
        )
        max_liquidated_fAsset_pool = (
            ec.mintedUBA
            * (ec.target_ratio_pool_bips - ec.collateral_ratio_pool_bips)
            // (ec.target_ratio_pool_bips - ec.liquidation_factor_pool_bips)
        )
        return min(
            ec.mintedUBA,
            max(0, max_liquidated_fAsset_vault, max_liquidated_fAsset_pool),
        )

    def maxLiquidatedVault(ec):
        return ec._swapInDex1(ec.maxLiquidatedFAssetUBA())

    def optLiquidatedFAsset(ec):
        return min(ec.maxLiquidatedFAssetUBA(), ec._swapDex1(ec._optLiquidatedVault()))

    def optLiquidatedVault(ec):
        return max(0, ec._swapInDex1(ec.optLiquidatedFAsset()))

    def arbitrageProfit(ec, v):
        return (
            ec._liquidateVault(ec._swapDex1(v))
            + ec._swapDex2(ec._liquidatePool(ec._swapDex1(v)))
            - v
        )

    @abstractmethod
    def _optLiquidatedVault(ec):
        raise NotImplementedError()

    ######################################################################
    # Methods to aid in visualisation

    def applyPriceDiscrepancyDex1(self, discrepancyBips):
        self.dex1_discrepancy = discrepancyBips
        self.dex1_vault_reserve = (
            self.dex1_fAsset_reserve
            * (10_000 + discrepancyBips)
            * self.fAsset_vault_price_bips
            // 10_000**2
        )

    def applyPriceDiscrepancyDex2(self, discrepancyBips):
        self.dex2_discrepancy = discrepancyBips
        self.dex2_pool_reserve = (
            self.dex2_vault_reserve
            * (10_000 + discrepancyBips)
            * self.vault_price_pool_bips
            // 10_000**2
        )

    # treat liqudity as fAsset reserve and
    # update vault reserve accordingly
    def updateDex1Liquidity(self, f):
        self.dex1_fAsset_reserve = f
        self.applyPriceDiscrepancyDex1(self.dex1_discrepancy)

    def updateDex2Liquidity(self, v):
        self.dex2_vault_reserve = v
        self.applyPriceDiscrepancyDex2(self.dex2_discrepancy)


# implements the optimum calculation of simplified arbitrageProfit function,
# where we don't account for slippage when swapping pool collateral on dex2
class SymbolicOptimum(ArbitrageStrategy):
    def _optLiquidatedVault(ec):
        amount = isqrt(ec.dex1_vault_reserve * 997 // 1000 * ec.dex2_pool_reserve)
        aux1 = (
            ec.dex1_fAsset_reserve
            * ec.liquidation_factor_vault_bips
            // 10_000
            * ec.fAsset_vault_price_bips
            // 10_000
            * ec.dex2_pool_reserve
        )
        aux2 = (
            ec.dex1_fAsset_reserve
            * ec.liquidation_factor_pool_bips
            // 10_000
            * ec.vault_price_pool_bips
            // 10_000
            * 997
            // 1000
            * ec.dex2_vault_reserve
        )
        amount *= isqrt(aux1 + aux2)
        aux3 = ec.dex1_vault_reserve * ec.dex2_pool_reserve
        amount -= aux3
        amount *= 1000
        amount //= 997
        amount //= ec.dex2_pool_reserve
        return amount


class NumericStrategy(ArbitrageStrategy):
    def _optLiquidatedVault(ec):
        raise NotImplementedError()


######################################################################
## define initial ecosystem

ETH = 100 # can't set to 1e18 as we're limited by numpy's int64

ecosystem = Ecosystem(
    dex1_vault_reserve=10_000 * ETH,
    dex1_fAsset_reserve=20_000 * ETH,
    dex2_pool_reserve=10_000 * ETH,
    dex2_vault_reserve=133 * ETH,
    fAsset_vault_price_bips=5_000,
    vault_price_pool_bips=10_000 * 5_000 // 133,
    liquidation_factor_vault_bips=10_000,
    liquidation_factor_pool_bips=2_000,
    collateral_ratio_vault_bips=11_000,
    collateral_ratio_pool_bips=12_000,
    target_ratio_vault_bips=15_000,
    target_ratio_pool_bips=20_000,
    mintedUBA=1000 * ETH,
)

strategy = SymbolicOptimum(ecosystem)

######################################################################
# Visualising arbitrage profit as a function of liquidated vault collateral

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.widgets import Slider

MAX_RESERVES = 40_000 * ETH
MAX_COLLATERAL_RATIO = 40_000
MAX_TARGET_RATIO = 40_000
MAX_LIQUIDATION_FACTOR = 20_000
LINSPACE_STEPS = 100


# The parametrized function to be plotted
def arbitrageProfit(v, ec: ArbitrageStrategy):
    return [ec.arbitrageProfit(v_) for v_ in v]


# define ax config
fig, main_ax = plt.subplots()
main_ax.set_title("Arbitrage profit as a function of liquidated vault collateral")
main_ax.set_xlabel("Liquidated vault collateral [v]")
main_ax.set_ylabel("Liquidation profit [p]")
main_ax.spines["top"].set_visible(False)
main_ax.spines["right"].set_visible(False)
main_ax.spines["left"].set_alpha(0.5)
main_ax.spines["bottom"].set_alpha(0.5)
main_ax.grid(color="grey", linestyle="-", linewidth=0.25, alpha=0.5)

# calculate vault and profit data
v_max = strategy.maxLiquidatedVault()
v = np.linspace(0, v_max, LINSPACE_STEPS)
p = np.array(arbitrageProfit(v, strategy))
p_argmax = p.argmax()
v_opt_real = v[p_argmax]
p_opt_real = p[p_argmax]
v_opt_apx = strategy.optLiquidatedVault()
p_opt_apx = strategy.arbitrageProfit(v_opt_apx)

# set domains
main_ax.set_xlim(0, 1.1 * v_max)
main_ax.set_ylim(0, 1.1 * p.max())

# get domain lines
v_lim_line = np.repeat(v_max, LINSPACE_STEPS)
p_lim_line = np.linspace(0, p.max(), LINSPACE_STEPS)

# plot curve, line, and two points
(profit_curve,) = main_ax.plot(v, p)
(limit_line,) = main_ax.plot(v_lim_line, p_lim_line, color="red")
opt_apx_point = main_ax.scatter(v_opt_apx, p_opt_apx, color="blue")
opt_real_point = main_ax.scatter(v_opt_real, p_opt_real, color="green")

# adjust the main plot to make room for the sliders
fig.subplots_adjust(bottom=0.25)

slider_configs = [
    {
        "label": "Dex1 liquidity",
        "valmin": ETH,
        "valmax": MAX_RESERVES,
        "valinit": strategy.dex1_fAsset_reserve,
        "color": "green",
        "on_changed": lambda v: strategy.updateDex1Liquidity(v),
    },
    {
        "label": "Dex2 liquidity",
        "valmin": ETH,
        "valmax": MAX_RESERVES,
        "valinit": strategy.dex2_vault_reserve,
        "color": "green",
        "on_changed": lambda v: strategy.updateDex2Liquidity(v),
    },
    {
        "label": "Dex1 price discrepancy",
        "valmin": -5_000,
        "valmax": 5_000,
        "valinit": 0,
        "color": "orange",
        "on_changed": lambda v: strategy.applyPriceDiscrepancyDex1(v),
    },
    {
        "label": "Dex2 price discrepancy",
        "valmin": -5_000,
        "valmax": 5_000,
        "valinit": 0,
        "color": "orange",
        "on_changed": lambda v: strategy.applyPriceDiscrepancyDex2(v),
    },
    {
        "label": "Vault collateral ratio",
        "valmin": 0,
        "valmax": MAX_COLLATERAL_RATIO,
        "valinit": strategy.collateral_ratio_vault_bips,
        "color": "green",
        "on_changed": lambda v: setattr(strategy, "collateral_ratio_vault_bips", v),
    },
    {
        "label": "Pool collateral ratio",
        "valmin": 0,
        "valmax": MAX_COLLATERAL_RATIO,
        "valinit": strategy.collateral_ratio_pool_bips,
        "color": "green",
        "on_changed": lambda v: setattr(strategy, "collateral_ratio_pool_bips", v),
    },
    {
        "label": "Vault liquidation factor",
        "valmin": 0,
        "valmax": MAX_LIQUIDATION_FACTOR,
        "valinit": strategy.liquidation_factor_vault_bips,
        "color": "green",
        "on_changed": lambda v: setattr(strategy, "liquidation_factor_vault_bips", v),
    },
    {
        "label": "Pool liquidation factor",
        "valmin": 0,
        "valmax": MAX_LIQUIDATION_FACTOR,
        "valinit": strategy.liquidation_factor_pool_bips,
        "color": "green",
        "on_changed": lambda v: setattr(strategy, "liquidation_factor_pool_bips", v),
    },
    {
        "label": "Vault target ratio",
        "valmin": 10_000,
        "valmax": MAX_TARGET_RATIO,
        "valinit": strategy.target_ratio_vault_bips,
        "color": "green",
        "on_changed": lambda v: setattr(strategy, "target_ratio_vault_bips", v),
    },
    {
        "label": "Pool target ratio",
        "valmin": 10_000,
        "valmax": MAX_TARGET_RATIO,
        "valinit": strategy.target_ratio_pool_bips,
        "color": "green",
        "on_changed": lambda v: setattr(strategy, "target_ratio_pool_bips", v),
    },
]

sliders = []
bottom_offset = 0.2 / len(slider_configs)
for i, slider_config in enumerate(slider_configs):
    slider_ax = fig.add_axes([0.1, 0.21 - i * bottom_offset, 0.8, 0.01])
    sliders.append(
        Slider(
            ax=slider_ax,
            label=slider_config["label"],
            valmin=slider_config["valmin"],
            valmax=slider_config["valmax"],
            valinit=slider_config["valinit"],
            color=slider_config["color"],
        )
    )


# The function to be called anytime a slider's value changes
def update_graph(on_changed):
    def update(val):
        on_changed(int(val))
        # recalculate main plot data
        v_max = strategy.maxLiquidatedVault()
        v = np.linspace(ETH, v_max, LINSPACE_STEPS)
        p = np.array(arbitrageProfit(v, strategy))
        # recalculate optimums
        p_argmax = p.argmax()
        v_opt_real = v[p_argmax]
        p_opt_real = p[p_argmax]
        v_opt_apx = strategy.optLiquidatedVault()
        p_opt_apx = strategy.arbitrageProfit(v_opt_apx)
        # recalculate domain lines
        v_lim_line = np.repeat(v_max, LINSPACE_STEPS)
        p_lim_line = np.linspace(0, p.max(), LINSPACE_STEPS)
        # reset domain and lines
        main_ax.set_xlim(0, 1.1 * v_max)
        main_ax.set_ylim(0, 1.1 * p.max())
        # reset and redraw everything
        profit_curve.set_xdata(v)
        profit_curve.set_ydata(arbitrageProfit(v, strategy))
        limit_line.set_xdata(v_lim_line)
        limit_line.set_ydata(p_lim_line)
        opt_apx_point.set_offsets(np.c_[v_opt_apx, p_opt_apx])
        opt_real_point.set_offsets(np.c_[v_opt_real, p_opt_real])
        fig.canvas.draw_idle()

    return update


# register the update function with each slider
for config, slider in zip(slider_configs, sliders):
    slider.on_changed(update_graph(config["on_changed"]))

plt.show()
