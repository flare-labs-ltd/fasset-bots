from abc import ABC, abstractmethod
from collections import namedtuple
from math import isqrt

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
        # note that vault and pool collaterals
        # are derived from crs, prices and mintedUBA
        "mintedUBA",
    ],
)


class ArbitrageStrategy(ABC):
    def __init__(self, ec):
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
        self.dex1_vault_reserve = (
            self.dex1_fAsset_reserve
            * (10_000 + discrepancyBips)
            // self.fAsset_vault_price_bips
        )

    def applyPriceDiscrepancyDex2(self, discrepancyBips):
        self.dex2_pool_reserve = (
            self.dex2_vault_reserve
            * (10_000 + discrepancyBips)
            // self.vault_price_pool_bips
        )

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
        return None


# make a plot of liquidation reward dependant on invested vault collateral,
# and color red a point on x-axis of our optimum and green vault collateral
# yielding full liquidation

ETH = 1_000_000

ecosystem = Ecosystem(
    dex1_vault_reserve=30_000 * ETH,
    dex1_fAsset_reserve=60_001 * ETH,
    dex2_pool_reserve=100_000 * ETH,
    dex2_vault_reserve=1_333 * ETH,
    fAsset_vault_price_bips=5_000,
    vault_price_pool_bips=10_000 * 5_000 // 133,
    liquidation_factor_vault_bips=10_000,
    liquidation_factor_pool_bips=2_000,
    collateral_ratio_vault_bips=11_000,
    collateral_ratio_pool_bips=12_000,
    target_ratio_vault_bips=15_000,
    target_ratio_pool_bips=20_000,
    mintedUBA=50_000 * ETH,
)

strategy = SymbolicOptimum(ecosystem)

######################################################################
# Visualising arbitrage profit as a function of liquidated vault collateral

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.widgets import Slider

MAX_RESERVES = 100_000_000 * ETH
MAX_COLLATERAL_RATIO = 40_000
MAX_TARGET_RATIO = 20_000
MAX_LIQUIDATION_FACTOR = 20_000
LINSPACE_STEP = 100

# The parametrized function to be plotted
def arbitrageProfit(v, ec: ArbitrageStrategy):
    return [ec.arbitrageProfit(v_) for v_ in v]

v_max = strategy.maxLiquidatedVault()

v = np.linspace(ETH, v_max, LINSPACE_STEP)
p = np.array(arbitrageProfit(v, strategy))

p_argmax = p.argmax()
v_opt_real = v[p_argmax]
p_opt_real = p[p_argmax]
f_opt_real = strategy._swapDex1(v_opt_real)

v_opt_apx = strategy.optLiquidatedVault()
p_opt_apx = strategy.arbitrageProfit(v_opt_apx)
f_opt_apx = strategy._swapDex1(v_opt_apx)

# define ax config
fig, ax = plt.subplots()
ax.set_title("Arbitrage profit as a function of liquidated vault collateral")
ax.set_xlabel('Liquidated vault collateral [v]')
ax.set_ylabel('Liquidation profit [p]')
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
ax.spines['left'].set_alpha(0.5)
ax.spines['bottom'].set_alpha(0.5)
ax.grid(color='grey', linestyle='-', linewidth=0.25, alpha=0.5)

# plot curve and two points
profit_curve, = ax.plot(v, p)
opt_apx_point = ax.scatter(v_opt_apx, p_opt_apx, color="red")
opt_real_point = ax.scatter(v_opt_real, p_opt_real, color="green")

# adjust the main plot to make room for the sliders
fig.subplots_adjust(bottom=0.25)

# Make a horizontal slider to control the frequency.
dex1_vault_reserve_ax = fig.add_axes([0.1, 0.01, 0.8, 0.01])
dex1_vault_reserve_slider = Slider(
    ax=dex1_vault_reserve_ax,
    label='Dex1 f-asset reserves',
    valmin=ETH,
    valmax=MAX_RESERVES,
    valinit=strategy.dex1_vault_reserve
)
dex1_price_discrepancy_ax = fig.add_axes([0.1, 0.02, 0.8, 0.01])
dex1_price_discrepancy_slider = Slider(
    ax=dex1_price_discrepancy_ax,
    label='Percentage by which dex1 f-asset price differs from the ftso price',
    valmin=-10_000,
    valmax=10_000,
    valinit=0
)
dex1_price_discrepancy_ax = fig.add_axes([0.1, 0.03, 0.8, 0.01])
dex2_pool_reserve_sider = Slider(
    ax=dex1_price_discrepancy_ax,
    label='Dex2 pool reserves',
    valmin=ETH,
    valmax=MAX_RESERVES,
    valinit=strategy.dex2_pool_reserve
)
dex2_price_discrepancy_ax = fig.add_axes([0.1, 0.04, 0.8, 0.01])
dex2_price_discrepancy_slider = Slider(
    ax=dex2_price_discrepancy_ax,
    label='Percentage by which dex2 price differs from the ftso price',
    valmin=-10_000,
    valmax=-10_000,
    valinit=0
)
collateral_ratio_vault_ax = fig.add_axes([0.1, 0.05, 0.8, 0.01])
collateral_ratio_vault_slider = Slider(
    ax=collateral_ratio_vault_ax,
    label='Vault collateral ratio',
    valmin=0,
    valmax=MAX_COLLATERAL_RATIO,
    valinit=strategy.collateral_ratio_vault_bips
)
liquidation_factor_vault_ax = fig.add_axes([0.1, 0.06, 0.8, 0.01])
liquidation_factor_vault_slider = Slider(
    ax=liquidation_factor_vault_ax,
    label='Vault liquidation factor',
    valmin=0,
    valmax=MAX_LIQUIDATION_FACTOR,
    valinit=strategy.liquidation_factor_vault_bips
)
liquidation_factor_pool_ax = fig.add_axes([0.1, 0.07, 0.8, 0.01])
liquidation_factor_pool_slider = Slider(
    ax=liquidation_factor_pool_ax,
    label='Pool liquidation factor',
    valmin=0,
    valmax=MAX_LIQUIDATION_FACTOR,
    valinit=strategy.liquidation_factor_pool_bips
)
target_ratio_vault_ax = fig.add_axes([0.1, 0.08, 0.8, 0.01])
target_ratio_vault_slider = Slider(
    ax=target_ratio_vault_ax,
    label='Vault target ratio',
    valmin=0,
    valmax=MAX_TARGET_RATIO,
    valinit=strategy.target_ratio_vault_bips
)
target_ratio_pool_ax = fig.add_axes([0.1, 0.09, 0.8, 0.01])
target_ratio_pool_slider = Slider(
    ax=target_ratio_pool_ax,
    label='Pool target ratio',
    valmin=0,
    valmax=MAX_TARGET_RATIO,
    valinit=strategy.target_ratio_pool_bips
)

# The function to be called anytime a slider's value changes
def update(_):
    # update data
    strategy.dex1_vault_reserve = dex1_vault_reserve_slider.val
    strategy.applyPriceDiscrepancyDex1(dex1_price_discrepancy_slider.val)
    strategy.dex2_pool_reserve = dex2_pool_reserve_sider.val
    strategy.applyPriceDiscrepancyDex2(dex2_price_discrepancy_slider.val)
    strategy.collateral_ratio_vault_bips = collateral_ratio_vault_slider.val
    # update graph
    v_max = strategy.maxLiquidatedVault()
    v = np.linspace(ETH, v_max, LINSPACE_STEP)
    profit_curve.set_xdata(v)
    profit_curve.set_ydata(arbitrageProfit(v, strategy))
    fig.canvas.draw_idle()

# register the update function with each slider
dex1_vault_reserve_slider.on_changed(update)
dex1_price_discrepancy_slider.on_changed(update)
dex2_pool_reserve_sider.on_changed(update)
dex2_price_discrepancy_slider.on_changed(update)
collateral_ratio_vault_slider.on_changed(update)

plt.show()