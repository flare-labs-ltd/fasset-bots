from collections import namedtuple
from math import isqrt

Ecosystem = namedtuple('Ecosystem', [
    # dexes
    'dex1_vault_reserve',
    'dex1_fAsset_reserve',
    'dex2_pool_reserve',
    'dex2_vault_reserve',
    # prices
    'fAsset_vault_price_bips',
    'fAsset_pool_price_bips',
    # agent
    'liquidation_factor_vault_bips',
    'liquidation_factor_pool_bips',
    'collateral_ratio_vault_bips',
    'collateral_ratio_pool_bips',
    'target_ratio_vault_bips',
    'target_ratio_pool_bips',

    'mintedUBA'
])

def _swapDex1(ec, v):
    v_with_fee = 997 * v
    numerator = 1000 * ec.dex1_vault_reserve * v_with_fee
    denominator = 1000 * ec.dex1_fAsset_reserve + v_with_fee
    return numerator // denominator

def _swapDex2(ec, w):
    w_with_fee = 997 * w
    numerator = 1000 * ec.dex2_pool_reserve * w_with_fee
    denominator = 1000 * ec.dex2_vault_reserve + w_with_fee
    return numerator // denominator

def _swapInDex1(ec, f):
    numerator = 1000 * ec.dex1_vault_reserve * f
    denominator = 997 * (ec.dex1_fAsset_reserve - f)
    return numerator // denominator + 1

def _liquidateVault(ec, f):
    return f * ec.liquidation_factor_vault_bips * \
        ec.fAsset_vault_price_bips // 10_000**2

def _liquidatePool(ec, f):
    return f * ec.liquidation_factor_pool_bips * \
        ec.fAsset_pool_price_bips // 10_000**2

def _optLiquidatedVault(ec):
    return max(0, (
        -ec.dex1_vault_reserve * ec.dex2_pool_reserve + isqrt(
        ec.dex1_fAsset_reserve * ec.dex1_vault_reserve *
        ec.dex2_pool_reserve * 997 ** 3 // 10_000 ** 3 *
        (
            ec.liquidation_factor_vault_bips *
            ec.fAsset_vault_price_bips *
            ec.dex2_pool_reserve *
            997**2 // 10_000**2 +
            ec.liquidation_factor_pool_bips *
            ec.fAsset_pool_price_bips *
            ec.dex2_vault_reserve *
            997**3 // 10_000**3
        )
    )) // ec.dex2_pool_reserve * 10_000**2 // 997**2)

def maxLiquidatedFAssetUBA(ec):
    max_liquidated_fAsset_vault = ec.mintedUBA * (
        ec.target_ratio_vault_bips - ec.collateral_ratio_vault_bips
    ) // (ec.target_ratio_vault_bips - ec.liquidation_factor_vault_bips)
    max_liquidated_fAsset_pool = ec.mintedUBA * (
        ec.target_ratio_pool_bips - ec.collateral_ratio_pool_bips
    ) // (ec.target_ratio_pool_bips - ec.liquidation_factor_pool_bips)
    return max(0, max_liquidated_fAsset_vault, max_liquidated_fAsset_pool)

def optLiquidatedFAsset(ec):
    return min(maxLiquidatedFAssetUBA(ec), _swapDex1(ec, _optLiquidatedVault(ec)))

def maxLiquidatedVault(ec):
    return _swapInDex1(ec, maxLiquidatedFAssetUBA(ec))

def optLiquidatedVault(ec):
    return max(0, _swapInDex1(ec, optLiquidatedFAsset(ec)))

def arbitrageProfit(ec, v):
    return _liquidateVault(ec, _swapDex1(ec, v)) + \
        _swapDex2(ec, _liquidatePool(ec, _swapDex1(ec, v)))

import matplotlib.pyplot as plt
from matplotlib.widgets import Slider

# make a plot of liquidation reward dependant on invested vault collateral,
# and color red a point on x-axis of our optimum and green vault collateral
# yielding full liquidation

ecosystem = Ecosystem(
    dex1_vault_reserve = 20_000,
    dex1_fAsset_reserve = 40_001,
    dex2_pool_reserve = 100_000,
    dex2_vault_reserve = 1_333,
    fAsset_vault_price_bips = 5_000,
    fAsset_pool_price_bips = 10_000 * 5_000 // 133,
    liquidation_factor_vault_bips = 10000,
    liquidation_factor_pool_bips = 1000,
    collateral_ratio_vault_bips = 11_000,
    collateral_ratio_pool_bips = 12_000,
    target_ratio_vault_bips = 15_000,
    target_ratio_pool_bips = 20_000,
    mintedUBA = 50_000
)

import numpy as np

v_max = maxLiquidatedVault(ecosystem)
p_max = arbitrageProfit(ecosystem, v_max)

V = np.linspace(0, v_max, 1000)
P = np.array([arbitrageProfit(ecosystem, v_) for v_ in V])

v_opt = optLiquidatedVault(ecosystem)
p_opt = arbitrageProfit(ecosystem, v_opt)

print("optimal vault ", v_opt)
print("optimal profit", p_opt)
print("max profit    ", P.max())
print("max f-assets  ", maxLiquidatedFAssetUBA(ecosystem))
print("liq f-assets  ", _swapDex1(ecosystem, v_opt))

print(_swapDex1(ecosystem, v_max))

plt.plot(V, P)
plt.scatter(v_opt, p_opt, color='red')
plt.show()