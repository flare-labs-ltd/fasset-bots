// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity >=0.7.5;
pragma abicoder v2;


interface IUniswapV2Router {
    function factory() external view returns (address);

    function wNat() external view returns (address);

    // Note:
    // The minimum amounts and the returned amounts in the add/remove liquidity
    // functions are *always* relative to the sent amounts, the received amounts may
    // be different in the case of fee-on-transfer tokens.
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        uint256 feeBipsA,
        uint256 feeBipsB,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB);

    // Note:
    // Swap functions with exact input can be called with paths including fee-on-transfer tokens,
    // and the `amountOutMin` will be checked against what's actually been received by the `to` address.
    // Swap functions with exact output cannot be called with paths including fee-on-transfer tokes.
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amountsSent, uint256[] memory amountsRecv);

    function pairFor(address tokenA, address tokenB) external view returns (address);

    function getReserves(address tokenA, address tokenB) external view returns (uint256, uint256);
}