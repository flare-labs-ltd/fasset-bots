// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;


// constants for dex fees and bips settings
uint256 constant MAX_BIPS = 10000;
uint256 constant DEX_MAX_BIPS = 1000;
uint256 constant DEX_FEE_BIPS = 3;
uint256 constant DEX_FACTOR_BIPS = DEX_MAX_BIPS - DEX_FEE_BIPS;

// default values
uint256 constant MAX_SLIPPAGE_BIPS = 100;

// optimum calculation config
uint256 constant MAX_BISECTION_ITERATIONS = 20;
uint256 constant BISECTION_PRECISION = 10000;