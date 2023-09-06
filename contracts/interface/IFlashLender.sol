// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";

interface IFlashLender {

    function token() external view returns (IERC20);
    function flashFee() external view returns (uint256);
    function flashFeeReceiver() external view returns (address);
    function maxFlashLoan() external view returns (uint256);

    function flashLoan(
        IERC3156FlashBorrower _receiver,
        uint256 _value,
        bytes calldata _data
    ) external returns (bool);

}