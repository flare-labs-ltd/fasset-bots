// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IUniswapV2Router } from "../interfaces/IUniswapV2/IUniswapV2Router.sol";


// the two functions that differ from the blazeswap's uniswapV2Router
// interface which is used for our IUniswapV2Router interface
interface IEnosysDexRouter {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] memory path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
    function getPairReserves(address tokenA, address tokenB)  external view returns (uint reserveA, uint reserveB);
}

/**
 * @title UniswapV2
 * @notice This contract unifies the two
 * implementations of uniswap v2 router on Flare
 * (BlazeSwapRouter and EnosysDexRouter)
 */
library UniswapV2 {

    function swapExactTokensForTokens(
        address router,
        uint amountIn,
        uint amountOutMin,
        address[] memory path,
        address to,
        uint deadline
    )
        internal
        returns (uint[] memory, uint[] memory)
    {
        try IUniswapV2Router(router).swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline) returns (uint[] memory _amountsSent, uint[] memory _amountsRecv) {
            return (_amountsSent, _amountsRecv);
        } catch (bytes memory reason1) {
            require(reason1.length == 0, parseRevertMsg(reason1));
            try IEnosysDexRouter(router).swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline) returns (uint[] memory _amounts) {
                return (new uint[](0), _amounts);
            } catch (bytes memory reason2) {
                require(reason2.length == 0, parseRevertMsg(reason2));
                revert("UniswapV2: swapExactTokensForTokens failed");
            }
        }
    }

    function getReserves(
        address router,
        address tokenA,
        address tokenB
    )
        internal view
        returns (uint, uint)
    {
        try IUniswapV2Router(router).getReserves(tokenA, tokenB) returns (uint _reserveA, uint _reserveB) {
            return (_reserveA, _reserveB);
        } catch (bytes memory reason1) {
            require(reason1.length == 0, parseRevertMsg(reason1));
            try IEnosysDexRouter(router).getPairReserves(tokenA, tokenB) returns (uint _reserveA, uint _reserveB) {
                return (_reserveA, _reserveB);
            } catch (bytes memory reason2) {
                require(reason2.length == 0, parseRevertMsg(reason2));
                revert("UniswapV2: getReserves failed");
            }
        }
    }

    function parseRevertMsg(
        bytes memory _msg
    )
        private pure
        returns (string memory)
    {
        bytes memory newMsg = new bytes(_msg.length - 4);
        for (uint i = 0; i < newMsg.length; i++) {
            newMsg[i] = _msg[i + 4];
        }
        return abi.decode(newMsg, (string));
    }
}
